#!/usr/bin/env python3 -u
"""Mock ACP agent for integration tests.

Reads JSON-RPC messages from stdin (one per line), responds on stdout.
Implements session/new and session/prompt methods.
Exits gracefully on session/end or when stdin is closed.
"""

import json
import sys


def handle_message(msg):
    method = msg.get("method", "")
    msg_id = msg.get("id")

    if method == "session/new":
        response = {
            "jsonrpc": "2.0",
            "id": msg_id,
            "result": {"sessionId": "mock-session-001"},
        }
        sys.stdout.write(json.dumps(response) + "\n")
        sys.stdout.flush()

    elif method == "session/prompt":
        # First emit a notification (no id, has method)
        notification = {
            "jsonrpc": "2.0",
            "method": "session/update",
            "params": {
                "sessionId": "mock-session-001",
                "update": {
                    "sessionUpdate": "agent_message_chunk",
                    "content": {"type": "text", "text": "Hello from mock agent"},
                },
            },
        }
        sys.stdout.write(json.dumps(notification) + "\n")
        sys.stdout.flush()

        # Then return the prompt response
        response = {
            "jsonrpc": "2.0",
            "id": msg_id,
            "result": {"stopReason": "end_turn"},
        }
        sys.stdout.write(json.dumps(response) + "\n")
        sys.stdout.flush()

    elif method == "session/end":
        # Graceful exit — respond and then exit
        if msg_id is not None:
            response = {
                "jsonrpc": "2.0",
                "id": msg_id,
                "result": {},
            }
            sys.stdout.write(json.dumps(response) + "\n")
            sys.stdout.flush()
        sys.exit(0)

    else:
        # Notifications (no id) — just ignore
        if msg_id is not None:
            error_response = {
                "jsonrpc": "2.0",
                "id": msg_id,
                "error": {
                    "code": -32601,
                    "message": f"Method not found: {method}",
                },
            }
            sys.stdout.write(json.dumps(error_response) + "\n")
            sys.stdout.flush()


def main():
    while True:
        line = sys.stdin.readline()
        if not line:
            break
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
            handle_message(msg)
        except json.JSONDecodeError:
            pass


if __name__ == "__main__":
    main()
