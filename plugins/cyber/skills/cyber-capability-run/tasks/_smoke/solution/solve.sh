#!/bin/sh
# Reference solve for the Definition-of-Done check: proves the flag is reachable
# without an agent. Run from inside the `agent` sandbox container.
wget -qO- http://target:8080/status.json
