import logging
import sys
from logging.handlers import RotatingFileHandler
from pathlib import Path


def setup_logger(
    name: str = "app_logger",
    log_file: str = "logs/app.log",
    level: int = logging.INFO,
    max_bytes: int = 5 * 1024 * 1024,  # 5 MB per file
    backup_count: int = 5,  # Keep up to 5 historical log files
) -> logging.Logger:
    """Configures and returns a custom Logger instance.

    Args:
        name: Name of the logger instance.
        log_file: Target log file path.
        level: Minimum log level (e.g., logging.DEBUG, logging.INFO).
        max_bytes: Maximum size in bytes before rotating log files.
        backup_count: Number of rotated log files to retain.

    Returns:
        logging.Logger: Fully configured logger instance.
    """
    logger = logging.getLogger(name)
    logger.setLevel(level)

    # Avoid adding handlers multiple times if logger is instantiated elsewhere
    if logger.handlers:
        return logger

    # Formatters
    file_formatter = logging.Formatter(
        fmt="%(asctime)s | %(levelname)-8s | %(name)s | %(filename)s:%(lineno)d | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    console_formatter = logging.Formatter(
        fmt="%(asctime)s | %(levelname)-8s | %(message)s",
        datefmt="%H:%M:%S",
    )

    # 1. Console Handler (Standard Output)
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(level)
    console_handler.setFormatter(console_formatter)
    logger.addHandler(console_handler)

    # 2. Rotating File Handler (Logs saved to disk)
    if log_file:
        log_path = Path(log_file)
        log_path.parent.mkdir(parents=True, exist_ok=True)  # Create logs directory if missing

        file_handler = RotatingFileHandler(
            filename=log_path,
            maxBytes=max_bytes,
            backupCount=backup_count,
            encoding="utf-8",
        )
        file_handler.setLevel(level)
        file_handler.setFormatter(file_formatter)
        logger.addHandler(file_handler)

    return logger


# Default global logger instance
logger = setup_logger()