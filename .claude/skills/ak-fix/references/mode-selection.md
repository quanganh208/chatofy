# Mode Selection

Ask with the `ask_user` capability at the start only when the user gave no mode flag, no
earlier context set the mode, and the issue is not clearly trivial (a type or lint error
defaults to quick). Offer "Autonomous (Recommended)" (`--auto`), "Human-in-the-loop"
(`--review`) and "Quick fix" (`--quick`).

| Issue type | Recommended mode |
|------------|------------------|
| Type or lint errors | Quick |
| Single-file bug | Quick or Autonomous |
| Multi-file, unclear root cause | Autonomous |
| Production-critical, system-wide or security issue | Human-in-the-loop |
