"""Heuristic `analyze` pass — no LLM yet.

Walks every .py file in the repo, parses imports with `ast`, and flags
modules that touch a real boundary (DB, queue, cache, async, cloud,
HTTP client) without an integration test alongside them. A unit test
that mocks the boundary doesn't count — that's the problem we're built
to surface.

Two heuristics make the v1 useful:

- **Transitive boundaries.** A file like `main.py` rarely imports
  `sqlalchemy` or `redis` directly; it imports the local `db` and
  `cache` modules that do. We propagate the boundary kind up through
  local package imports so the composition file (where the bugs
  usually live) is the one that ranks highest.
- **Test discovery by import graph.** A real team has one `test_unit.py`
  covering many source modules, not one test file per source. We index
  every test file by the source modules it imports, and ask "is there a
  test that imports me, and does it mock my boundaries?"

Each gap is annotated with the git commits that touched the file in the
configured window and the Jira tickets those commits reference.
"""

from __future__ import annotations

import ast
from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path

from .boundaries import BoundaryKind, classify


_SKIP_DIR_NAMES = {
    ".git", ".venv", "venv", "__pycache__", ".mypy_cache", ".pytest_cache",
    ".ruff_cache", "node_modules", "dist", "build", ".tox", ".idea", ".vscode",
    "proposed", "verdicts", ".qa-agent",
}

_MOCK_IMPORTS = frozenset({"unittest.mock", "mock", "pytest_mock", "asynctest"})
_INTEGRATION_PREFIXES = ("testcontainers",)


@dataclass
class BoundaryHit:
    module: str
    kind: BoundaryKind
    line: int
    via: str | None = None
    """`None` if direct; the local module name if propagated transitively."""


@dataclass
class TestNeighbor:
    path: Path
    has_mocks: bool
    has_integration: bool
    mocked_targets: list[str] = field(default_factory=list)

    @property
    def shape(self) -> str:
        if self.has_integration:
            return "integration"
        if self.has_mocks:
            return "unit (mocked)"
        return "unit"


@dataclass
class Gap:
    file: Path
    hits: list[BoundaryHit] = field(default_factory=list)
    tests: list[TestNeighbor] = field(default_factory=list)
    touches: list[str] = field(default_factory=list)
    tickets: list[str] = field(default_factory=list)

    @property
    def kinds(self) -> list[BoundaryKind]:
        seen: dict[str, BoundaryKind] = {}
        for h in self.hits:
            seen[h.kind.code] = h.kind
        return list(seen.values())

    @property
    def coverage(self) -> str:
        if any(t.has_integration for t in self.tests):
            return "integration"
        if any(t.has_mocks for t in self.tests):
            return "unit (mocked)"
        if self.tests:
            return "unit"
        return "none"

    @property
    def severity(self) -> str:
        if self.coverage == "integration":
            return "ok"
        if self.coverage == "none":
            return "high"
        # Mock-only coverage. A composition file that crosses multiple
        # boundaries with only mocks is exactly the unit-test-theater
        # shape this agent exists to surface — promote to high.
        if len(self.kinds) >= 2:
            return "high"
        return "med"

    def rank_key(self) -> tuple[int, int, int, int]:
        sev = {"high": 2, "med": 1, "ok": 0}[self.severity]
        weight = sum(k.weight for k in self.kinds)
        return (sev, len(self.kinds), weight, len(self.touches))


def _iter_py_files(root: Path) -> Iterable[Path]:
    for path in root.rglob("*.py"):
        if any(part in _SKIP_DIR_NAMES for part in path.parts):
            continue
        yield path


def _parse(path: Path) -> ast.Module | None:
    try:
        return ast.parse(path.read_text(encoding="utf-8"))
    except (SyntaxError, UnicodeDecodeError, OSError):
        return None


def _imports(tree: ast.AST) -> Iterable[tuple[str, int, int]]:
    """Yield (module_name, level, lineno).

    `level` is the relative-import depth (0 for absolute). For
    `from . import x, y, z` (which has `node.module is None`) we yield
    one entry per name — each `x`, `y`, `z` is its own sibling module.
    """
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                yield alias.name, 0, node.lineno
        elif isinstance(node, ast.ImportFrom):
            level = node.level or 0
            if node.module:
                yield node.module, level, node.lineno
            elif level:
                for alias in node.names:
                    yield alias.name, level, node.lineno


def _patch_targets(tree: ast.AST) -> list[str]:
    """Find arg of every `patch("a.b.c")` / `mock.patch("...")` call."""
    targets: list[str] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        name = ""
        if isinstance(func, ast.Attribute):
            name = func.attr
        elif isinstance(func, ast.Name):
            name = func.id
        if name not in {"patch", "patch.object"}:
            continue
        if not node.args:
            continue
        arg = node.args[0]
        if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
            targets.append(arg.value)
    return targets


def _is_test_file(path: Path) -> bool:
    name = path.name
    if name.startswith("test_") or name.endswith("_test.py"):
        return True
    return "tests" in path.parts


@dataclass
class _FileFacts:
    path: Path
    """Absolute path."""
    rel: Path
    """Repo-relative path."""
    direct_boundaries: list[BoundaryHit]
    """Boundary imports observed directly in this file."""
    local_imports: list[tuple[str, int]]
    """Absolute module names of imports that look local to this repo."""
    is_test: bool
    test_mocked_targets: list[str]
    has_integration_lib: bool
    has_mock_lib: bool


def _module_path(path: Path) -> str:
    """Compute a file's Python module path the way the runtime sees it.

    Walks up the directory tree as long as each parent has an
    `__init__.py`; stops at the first dir that doesn't. Anything above
    that is sys.path stuff, not part of the module name. So
    `examples/orders_service/orders_service/main.py` becomes
    `orders_service.main`, the same name the test uses to import it.
    """
    parents: list[str] = []
    cur = path.parent
    while (cur / "__init__.py").exists():
        parents.append(cur.name)
        nxt = cur.parent
        if nxt == cur:
            break
        cur = nxt
    parents.reverse()
    if path.name == "__init__.py":
        return ".".join(parents)
    return ".".join([*parents, path.stem])


def _scan(path: Path, repo: Path, local_pkg_roots: set[str]) -> _FileFacts:
    rel = path.relative_to(repo)
    own_module = _module_path(path)
    tree = _parse(path)
    direct: list[BoundaryHit] = []
    locals_: list[tuple[str, int]] = []
    has_integration = False
    has_mock = False
    mocked: list[str] = []
    is_test = _is_test_file(path)

    if tree is not None:
        for module, level, lineno in _imports(tree):
            kind = classify(module)
            if kind is not None:
                direct.append(BoundaryHit(module=module, kind=kind, line=lineno))
            if any(module.startswith(p) for p in _INTEGRATION_PREFIXES):
                has_integration = True
            if module in _MOCK_IMPORTS or any(module.startswith(m + ".") for m in _MOCK_IMPORTS):
                has_mock = True
            root = module.split(".", 1)[0]
            if level > 0 or root in local_pkg_roots:
                resolved = _resolve_relative(module, level, own_module)
                if resolved:
                    locals_.append((resolved, lineno))
        if is_test:
            mocked = _patch_targets(tree)

    return _FileFacts(
        path=path,
        rel=rel,
        direct_boundaries=direct,
        local_imports=locals_,
        is_test=is_test,
        test_mocked_targets=mocked,
        has_integration_lib=has_integration,
        has_mock_lib=has_mock,
    )


def _resolve_relative(module: str, level: int, own_module: str) -> str | None:
    """Turn a `from .x.y import z` into an absolute module path.

    `own_module` is the importing file's module path (e.g.
    `orders_service.main`). For `from . import cache` we pop the file's
    leaf and append `cache`.
    """
    if level <= 0:
        return module
    parts = own_module.split(".") if own_module else []
    # `from .` pops one level (the file's own module name)
    if parts:
        parts.pop()
    # Each extra dot pops one more parent
    for _ in range(level - 1):
        if not parts:
            return None
        parts.pop()
    if module:
        parts.append(module)
    return ".".join(parts) if parts else None


def _discover_local_pkg_roots(repo: Path) -> set[str]:
    """Every directory that contains an __init__.py is a package; its
    name is a valid root for absolute imports inside the repo. Top-level
    .py files also become roots."""
    roots: set[str] = set()
    for path in repo.iterdir():
        if path.is_file() and path.suffix == ".py":
            roots.add(path.stem)
    for init in repo.rglob("__init__.py"):
        if any(part in _SKIP_DIR_NAMES for part in init.parts):
            continue
        roots.add(init.parent.name)
    return roots


def _propagate(
    facts_by_module: dict[str, _FileFacts],
) -> dict[str, list[BoundaryHit]]:
    """Return module → all boundary hits, propagated through local imports.

    Bounded BFS; cycles are broken by the visited set.
    """
    out: dict[str, list[BoundaryHit]] = {}
    for start, f in facts_by_module.items():
        seen: set[str] = {start}
        stack: list[tuple[str, str | None]] = [(start, None)]
        hits: list[BoundaryHit] = []
        while stack:
            mod, via = stack.pop()
            current = facts_by_module.get(mod)
            if current is None:
                continue
            for h in current.direct_boundaries:
                hits.append(
                    BoundaryHit(module=h.module, kind=h.kind, line=h.line, via=via)
                )
            for imp_mod, _ in current.local_imports:
                if imp_mod in seen:
                    continue
                seen.add(imp_mod)
                stack.append((imp_mod, mod if via is None else via))
        out[start] = hits
    return out


def _index_tests(
    facts: list[_FileFacts],
) -> dict[str, list[TestNeighbor]]:
    """Map source module → list of test files that import it."""
    index: dict[str, list[TestNeighbor]] = {}
    for f in facts:
        if not f.is_test:
            continue
        neighbor = TestNeighbor(
            path=f.path,
            has_mocks=f.has_mock_lib or bool(f.test_mocked_targets),
            has_integration=f.has_integration_lib,
            mocked_targets=f.test_mocked_targets,
        )
        for imp_mod, _ in f.local_imports:
            index.setdefault(imp_mod, []).append(neighbor)
        # Also attribute via patch targets: patch("orders_service.main.cache")
        # is evidence the test exercises orders_service.main (mocking its
        # dependencies).
        for target in f.test_mocked_targets:
            parts = target.split(".")
            for i in range(len(parts), 0, -1):
                index.setdefault(".".join(parts[:i]), []).append(neighbor)
    # Deduplicate per source module.
    for mod, ts in index.items():
        seen: set[Path] = set()
        unique: list[TestNeighbor] = []
        for t in ts:
            if t.path in seen:
                continue
            seen.add(t.path)
            unique.append(t)
        index[mod] = unique
    return index


def analyze_repo(
    repo: Path,
    git_signals: Iterable | None = None,
) -> list[Gap]:
    """Scan a repo for integration-test gaps."""
    repo = repo.resolve()

    touches_by_file: dict[str, list[str]] = {}
    tickets_by_file: dict[str, set[str]] = {}
    if git_signals is not None:
        for sig in git_signals:
            short = sig.metadata.get("short", sig.id[:8])
            for f in sig.metadata.get("files", []):
                touches_by_file.setdefault(f, []).append(short)
                tickets_by_file.setdefault(f, set()).update(sig.metadata.get("ticket_refs") or [])

    local_roots = _discover_local_pkg_roots(repo)
    facts_list: list[_FileFacts] = []
    facts_by_module: dict[str, _FileFacts] = {}
    for path in _iter_py_files(repo):
        f = _scan(path, repo, local_roots)
        facts_list.append(f)
        facts_by_module[_module_path(f.path)] = f

    all_hits = _propagate(facts_by_module)
    tests_index = _index_tests(facts_list)

    gaps: list[Gap] = []
    for f in facts_list:
        if f.is_test:
            continue
        module = _module_path(f.path)
        hits = all_hits.get(module, [])
        if not hits:
            continue
        tests = list(tests_index.get(module, []))
        gap = Gap(
            file=f.rel,
            hits=hits,
            tests=tests,
            touches=touches_by_file.get(str(f.rel), []),
            tickets=sorted(tickets_by_file.get(str(f.rel), set())),
        )
        if gap.severity == "ok":
            continue
        gaps.append(gap)
    gaps.sort(key=Gap.rank_key, reverse=True)
    return gaps
