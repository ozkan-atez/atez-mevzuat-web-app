#!/bin/bash
set -euo pipefail
atez_root="$(cd "$(dirname "$0")/.." && pwd)"
atez_node="$(command -v node)"
atez_uid="$(id -u)"
python3 - "$atez_root" "$atez_node" <<'PY'
import sys, plistlib
from pathlib import Path
root, node = sys.argv[1:]
agents = Path.home() / 'Library/LaunchAgents'
logs = Path.home() / 'Library/Logs/ATEZ'
agents.mkdir(parents=True, exist_ok=True)
logs.mkdir(parents=True, exist_ok=True)
for mode in ['api','worker','web']:
    label = f'io.atez.mevzuat.{mode}'
    config = {'Label':label,'ProgramArguments':[node,f'{root}/deploy/run-local.mjs',mode],
              'WorkingDirectory':root,'RunAtLoad':True,'KeepAlive':True,'ThrottleInterval':10,
              'StandardOutPath':str(logs/f'{mode}.log'),'StandardErrorPath':str(logs/f'{mode}.error.log'),
              'EnvironmentVariables':{'PATH':f'{Path(node).parent}:/usr/local/bin:/usr/bin:/bin'}}
    with (agents/f'{label}.plist').open('wb') as output: plistlib.dump(config,output)
PY
# The studio now runs inside the API/worker without a separate listener.
if launchctl print "gui/$atez_uid/io.atez.mevzuat.studio" >/dev/null 2>&1; then
  launchctl bootout "gui/$atez_uid/io.atez.mevzuat.studio"
fi
launchctl disable "gui/$atez_uid/io.atez.mevzuat.studio"
for atez_mode in api worker web; do
  atez_label="io.atez.mevzuat.$atez_mode"
  launchctl enable "gui/$atez_uid/$atez_label"
  if launchctl print "gui/$atez_uid/$atez_label" >/dev/null 2>&1; then
    launchctl kickstart -k "gui/$atez_uid/$atez_label"
  else
    launchctl bootstrap "gui/$atez_uid" "$HOME/Library/LaunchAgents/$atez_label.plist"
  fi
done

