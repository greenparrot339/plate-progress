# Progressive Overload Trend Update

The PROGRESS tab includes a same-weight Progressive Overload trend designed to detect progressive overload from both load and rep performance.

- Groups history by exercise and exact weight.
- Uses the median reps across all sets performed at the tracked weight for each session.
- The current session can contain any number of sets (2, 3, 4, 5, etc.); it is not hard-coded to three sets.
- Establishes the baseline from the median of the four most recent qualifying same-weight sessions before the current session.
- A higher session median is shown as an improvement without immediately replacing the baseline.
- A new higher level is confirmed after three supporting sessions.
- A lower session median enters Performance Watch instead of being called a regression immediately.
- The next three same-weight sessions are used as the follow-up window; a return to baseline is shown as Recovered, while three continued below-baseline sessions are shown as Persistent underperformance.
- Changing weight starts a separate progression track; reps at different weights are never compared directly.
- The card also reports the number of sets at the tracked weight and the best set, so a session such as 5/5/4 or 4/4/5 is not hidden behind a single best-set value.
- The Personal Best calculation remains separate and unchanged: it uses the highest weight and the best reps achieved at that weight.

IndexedDB data format is unchanged. The existing STATS 3D model and other workout features are preserved.
