**1. What name, with at least 5 games, do you want considered as your best attempt?**

Impossible Egg Beater

**2. How many average points did you have on the leaderboard when you submitted your work?**

37

**3. What strategy did you use?**

You can (could) create games without Eggman if you have `pvp_` in the lobby name anywhere.

Instead of Eggman (and its predicable path), we instead create our own opponent that we call a sleeper agent.

The sleeper agent guesses the most common vowels before moving to the least common consonants. This is to ensure it guesses common letters while getting the least amount of points possible.

The main player guesses the most frequent letters based on a frequency table created from the words.txt.

After all vowels have been guessed, both the main player and the sleeper agent checks whether the game could be finished. This has multiple steps:
- Filter out all the vowels from the puzzle and add up the amount of letters/predicted letters. This gives a score of what the main player could finish with. If this is below the `PLAYER_WIN_THRESHOLD`, end the game early.
- For words with unknown letters, find the possible words in the word list that share the same known letters. Then, we check every combination of possible words against our possible moves. If any words are impossible, filter them out of the word to guess. There's a lot of common words like `cat` and `pat` that we can't be sure of, so we just go with the first words possible.
- The main player guesses the most common letter needed in the remaining letters for the guessed puzzle.

This allows us to set a score threshold of anything we want and the script will continue to run through games and only complete ones that we can score what we want in.

Edit (12/6/2024):
The oversight with pvp matches got patched so there's no super effective method to get an insane amount of points anymore. Even with a sleeper agent guessing vowels, the potential amount of points for the main player can never be >23 or so. The old script for pvp matches is `play-pvp.js` and the current code is in `play.js`.

**4. How could you improve your strategy do do even better?**

There's a performance bottleneck when starting every game that could be improved. There's also a chance that the server crashes and the script usually freezes up when that happens.
