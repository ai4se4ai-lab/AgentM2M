# DevTeam seed

The paper's running example team (RA / AR / DV / TS, Table II's correspondence relations, the
`insert-impact-analyst` adaptation rule). `team.json` here is a generated snapshot of the authoritative,
type-checked source at [`apps/engine/src/seed/devteam.ts`](../../apps/engine/src/seed/devteam.ts) — edit
the TypeScript file and re-run:

```bash
cd apps/engine
npx tsx -e "
import { devTeam } from './src/seed/devteam.ts';
import { writeFileSync } from 'node:fs';
writeFileSync('../../teams/devteam/team.json', JSON.stringify(devTeam, null, 2));
"
```

The engine auto-loads this team (id `devteam`) into its store on first boot.

Only the `RA<->TS` edge (`e4`) is exercised end-to-end against a real Ollama model in the automated test
suite (`apps/engine/test/integration/duration-parse-ollama.test.ts`) — `e1`–`e3` (RA/AR, AR/DV, DV/TS) are
runnable through the same engine but not yet covered by a real-model automated test. See
`docs/architecture.md` for the full list of scope simplifications.
