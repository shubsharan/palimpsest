"""Hostile-by-default clean solver staging and execution."""

from .bundle import ArchiveLimits, StagedSolver, inspect_archive, stage_solver_bundle
from .executor import execute_solver

__all__ = [
    "ArchiveLimits",
    "StagedSolver",
    "execute_solver",
    "inspect_archive",
    "stage_solver_bundle",
]
