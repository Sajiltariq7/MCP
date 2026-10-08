import sys
from loguru import logger

logger.remove()
logger.add(
    sys.stderr,
    format="{time} | {level} | {message}",
    level="INFO",
)
