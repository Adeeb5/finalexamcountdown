import sys
import os

# Add root directory to python path so we can import server.py
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from server import Handler

# Force rebuild 26: switch model to qwen/qwen3-32b to match allowed tier models
class handler(Handler):
    """
    Vercel Serverless Function handler that inherits our existing local HTTP Handler.
    """
    pass
