import sys
import os

# Add root directory to python path so we can import server.py
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from server import Handler

# Force rebuild 16: add fallback rules for other course codes
class handler(Handler):
    """
    Vercel Serverless Function handler that inherits our existing local HTTP Handler.
    """
    pass
