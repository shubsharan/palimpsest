"""Trusted corpus acquisition and preparation for Palimpsest."""

from .sources import Chapter, SourceDefinition, load_chapters, strip_gutenberg

__all__ = ["Chapter", "SourceDefinition", "load_chapters", "strip_gutenberg"]
