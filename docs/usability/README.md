# G4 usability test

Measures backlog goal **G4, fast first board**: a new user builds a minimal
board (CPU, memory, clock, UART, GPIO LED) from an empty canvas to a
compiling `.dtb`. Target: **median time under 15 minutes across 3 test
users, with no help from the authors** (US-13.4).

| File | For |
| --- | --- |
| [README.md](README.md) | The moderator: setup, script, timing rules |
| [task-card.md](task-card.md) | The participant: the board to build, printed or on a second screen |
| [session-sheet.md](session-sheet.md) | The moderator: one copy per session, filled during it |
| [results.md](results.md) | The summary of the three sessions and the follow-up stories |

## Participants

Three people who have written or changed a devicetree before and have never
used DesignTree. Aim for at least one board bring-up engineer and one BSP
maintainer, the two personas of the backlog. Colleagues of the authors are
fine; people who watched the app being built are not.

## Setup, before each session

1. A Linux machine with the release under test installed from its package
   (on Arch or Manjaro: `makepkg -si` in `packaging/arch/designtree-git`),
   not a development build. Write down the version from
   `pacman -Q designtree-git`.
2. `dtc` installed and a kernel checkout at the pinned tag
   (`scripts/fetch-kernel-dts.sh ~/linux`), already added and loaded under
   **Kernels…**, so the library shows "kernel 7.3". Choosing a kernel is
   setup, not part of the task.
3. A fresh profile otherwise: remove
   `~/.local/share/io.github.maurilan91.designtree` before adding the kernel,
   so there are no favorites, recents or earlier designs.
4. DesignTree open with one empty tab (**New**), maximized.
5. A browser tab with the user guide open at its introduction, **not** at the
   tutorial. The participant may read any chapter except "Tutorial: your
   first board", which walks through this exact board.
6. Screen recording running, if the participant agreed to it.
7. A clock with seconds, and this folder's session sheet.

## Script

Read this aloud, in your own words:

> Thanks for helping. We are testing the software, not you; anything that
> is hard is our problem to fix. I'll give you a short description of a
> board. Please describe it in DesignTree until you have a `.dtb` file. You
> can use the user guide in the browser, except the tutorial chapter. I
> can't help or answer questions about the software while you work, but
> please think aloud: say what you are looking for and what you expect to
> happen. You can stop at any time. Do you agree to be recorded?

Hand over the [task card](task-card.md). Start the clock when the
participant starts reading it.

During the session:

- Do not help, hint or confirm. If asked, answer "What would you try?" or
  "What do you expect?". If the participant is stuck for 5 minutes on one
  step, note it as a **block** and, only then, give the smallest hint that
  unblocks them; the session still counts, with the block recorded.
- Write down the time at each milestone on the session sheet, and every
  hesitation, wrong turn or comment, with its time.
- Stop at **30 minutes** if the board is not built; record the time as
  "> 30 min" and which milestones were reached.

The task ends when **Build .dtb** has produced a `.dtb` file. Stop the clock
then, even if the Schema check still lists problems; write down how many.

## After the task

Ask, and write down the answers:

1. On a scale from 1 (very hard) to 7 (very easy), how easy was the task?
2. What took the longest?
3. Was there a moment you did not know what to do next? When?
4. What did you expect the app to do that it did not?
5. Would you use it for your next board? Why or why not?

## Timing rules

- The time is wall-clock time from reading the task card to the `.dtb`,
  hints included.
- G4 is met when the median of the three times is under 15:00 and no
  session needed a hint. A session with a hint is reported, but marks G4 as
  not met without help.
- Report every time, including sessions over 30 minutes; the median of
  three is the middle one.

## From findings to stories

After the three sessions, fill in [results.md](results.md):

1. List each problem with the sessions it happened in and the time it cost.
2. Rate it: **blocker** (needed a hint or stopped the task), **major** (cost
   more than a minute, or seen in two sessions or more), **minor** (the rest).
3. For each blocker and major problem, create a GitHub issue named
   `US-x.y …` with the `user-story` label and a feature label, link it in
   the results, and add it to `docs/backlog.md`.
4. Close #43 with the results file linked.
