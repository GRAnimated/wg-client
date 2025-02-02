const LOG_DEBUG_INFO = false;
const MAX_ACTIVE_GAMES = 1;
const PLAYER_WIN_THRESHOLD = 20;

const NAME_MAIN = `test1`;
const NAME_SLEEPER = "test40";

require('core-js/actual');
const { Socket } = require('phoenix-channels');
const fs = require('node:fs');
const zlib = require('zlib');
const clc = require("cli-color");

const url = "wss://words.homework.quest/socket";
const alphabet = new Set("abcdefghijklmnopqrstuvwxyz".split(''));
const vowels = new Set("aeiou".split(''));
// const sleeperPattern = new Set("eiaouqjzxkwvfybhmpgcdltrns".split(''));
const sleeperPattern = new Set("eiaoutnrshdlfcmgypwbvkjxzq".split(''));
const enemyPattern = Array.from("tnrshdlfcmgypwbvkjxzqeaoiu".split(''));

const letter_frequency_table = { // calculated for words.txt
  'a': 7.716, 'b': 1.731, 'c': 4.225, 'd': 4.263, 'e': 11.813,
  'f': 1.443, 'g': 3.061, 'h': 2.033, 'i': 8.793, 'j': 0.187,
  'k': 0.82, 'l': 5.058, 'm': 2.625, 'n': 7.54, 'o': 5.942,
  'p': 2.963, 'q': 0.174, 'r': 7.317, 's': 7.69, 't': 7.09,
  'u': 3.242, 'v': 1.189, 'w': 0.871, 'x': 0.306, 'y': 1.614,
  'z': 0.294,
};

const words = zlib.gunzipSync(fs.readFileSync('words.txt.gz')).toString('utf-8').split("\n");

// sort the words by length so we don't have to loop through the entire list later
const wordsByLength = new Map();
words.forEach(word => {
  const length = word.length;
  if (!wordsByLength.get(length))
    wordsByLength.set(length, []);

  wordsByLength.get(length).push(word);
});

class SocketState {
  constructor() {
    this.socketMain = null;
    this.socketSleeper = null;
    this.channelMain = null;
    this.channelSleeper = null;
    this.processedViews = new Set();

    this.childConnected = false;
    this.mainConnected = false;

    this.lastPlayersLength = 0;
    this.gameFinished = false;
  }
};

function sortLettersByFrequency(letters) {
  return letters.sort((a, b) => {
    const countA = letter_frequency_table[a];
    const countB = letter_frequency_table[b];

    return countB - countA;
  });
}

function sortLettersByEnemyPriority(letters) {
  return letters.sort((a, b) => {
    return enemyPattern.indexOf(a) - enemyPattern.indexOf(b);
  });
}

function removeVowels(str) {
  return str.replace(/[aeiou]/gi, '');
}

function hasAllVowels(letters) {
  let vowelsArray = Array.from(vowels);
  return vowelsArray.every(vowel => letters.has(vowel.toLowerCase()));
}

function findCandidateWords(pattern, words) {
  // matches "a---e" to "apple"
  let regex = new RegExp('^' + pattern.replace(/-/g, '.') + '$');
  let match = words.filter(word => regex.test(word));

  return match;
}

function filterAndRankCandidates(patterns, possibleMoves) {
  let allCandidates = [];

  for (let pattern of patterns) {
    let candidate = findCandidateWords(pattern, wordsByLength.get(pattern.length))[0];
    allCandidates = allCandidates.concat(candidate);
  }

  let remainingLetters = allCandidates.reduce((acc, word) => acc.concat(word.split('')), []);
  let filteredLetters = cleanUpLetters(remainingLetters, possibleMoves);

  return [filteredLetters, allCandidates];
}

function cleanUpLetters(letters, possibleMoves) {
  let newLetters = [];
  for (let letter of letters) {
    if (!vowels.has(letter) && possibleMoves.includes(letter))
      newLetters.push(letter);
  }
  newLetters = sortLettersByEnemyPriority(newLetters);
  return newLetters;
}

function getUniqueLetters(str) {
  let uniqueLetters = new Set(str.replace(/[^a-z]/g, ''));
  return uniqueLetters;
}

function isValidCombination(puzzle, combination) {
  let testForPuzzle = combination.join(' ');

  let originalLetters = getUniqueLetters(puzzle);
  let guessedLetters = getUniqueLetters(testForPuzzle);

  const difference = [...guessedLetters].filter(letter => !originalLetters.has(letter));

  if (difference.length <= 1) {
    return true;
  }

  return false;
}

function generateCombinations(arrays) {
  const combine = (prefix, index) => {
    if (index === arrays.length) {
      result.push(prefix);
      return;
    }

    for (let i = 0; i < arrays[index].length; i++) {
      combine([...prefix, arrays[index][i]], index + 1);
    }
  };

  const result = [];
  combine([], 0);

  // console.log('Amount of combinations:', result.length);
  return result;
}

function patternCouldFinishPuzzle(puzzle, guesses) {
  let patterns = puzzle.split(' ');
  let candidatePuzzle = [];

  for (let pattern of patterns) {
    let candidates = findCandidateWords(pattern, wordsByLength.get(pattern.length));
    candidatePuzzle.push(candidates);
  }

  // there's a performance bottleneck in some puzzles generating 1.7 million combinations so lets not bother
  let totalCombinations = candidatePuzzle.reduce((acc, candidates) => acc * candidates.length, 1);
  if (totalCombinations > 384) {
    return false;
  }

  let allCombinations = generateCombinations(candidatePuzzle);

  for (let combination of allCombinations) {
    let potentialPoints = removeVowels(combination.join('')).length;
    if (potentialPoints < PLAYER_WIN_THRESHOLD + 3) { // + 3 is a hacky fix for the sleeper agent having to guess low frequency letters
      // console.log(`Player could only win ${potentialPoints}, ending game`);
      return true;
    }

    if (isValidCombination(puzzle, combination)) { // if any of them can
      return true;
    }
  }

  return false;
}

function checkSleeperForEarlyFinish(possibleMoves, players) {
  let mainPlayer = players.find(player => player.name === NAME_MAIN);

  if (mainPlayer && mainPlayer.score < PLAYER_WIN_THRESHOLD)
    return true;

  return false;
}

function checkMainPlayerForEarlyFinish(possibleMoves, players) {
  let mainPlayerScore = players.find(player => player.name === NAME_MAIN).score;

  if (mainPlayerScore < PLAYER_WIN_THRESHOLD)
    return true;

  return false;
}

function calculateEnemyPoints(view) {
  const guesses = new Set(view.guesses);
  const possibleMoves = removeVowels(Array.from(alphabet.difference(guesses)).join(''));

  console.log(possibleMoves.length);
}

function logTurnInfo(view, clientName, possibleMoves) {
  if (!LOG_DEBUG_INFO)
    return;

  const puzzle = view.puzzle;
  const guesses = new Set(view.guesses);

  const playerNames = view.players.map(player => player.name);
  const playerScores = view.players.map(player => player.score);

  log(clientName, 'debug', `Puzzle: `, Array.from(puzzle).join(''));
  log(clientName, 'debug', `Guesses:`, Array.from(guesses).join(''));
  log(clientName, 'debug', `Possible Moves:`, possibleMoves.join(''));
  // log(clientName, 'debug', (playerNames.join(' vs. ') + ':'));
  log(clientName, 'debug', (playerScores.join(' to ') + ' points\n'));
}

function log(name, type, ...msg) {
  if (!LOG_DEBUG_INFO && type === 'debug')
    return;

  let color = clc.gray;
  let displayName = "[]";
  if (name === NAME_MAIN) {
    color = clc.green;
    displayName = "[Main]"; // looks better than displaying the player's actual name
  }
  if (name === NAME_SLEEPER) {
    color = clc.yellow;
    displayName = "[Sleeper]";
  }

  console.log(color(displayName, msg.join(' ')));
}

async function initChannels() {
  const game = `auto-${1 + Math.floor(10000000 * Math.random())}`;

  let state = new SocketState();

  state.socketSleeper = new Socket(url);
  state.channelSleeper = state.socketSleeper.channel(`game:${game}`, { name: NAME_SLEEPER });

  state.socketMain = new Socket(url);
  state.channelMain = state.socketMain.channel(`game:${game}`, { name: NAME_MAIN });

  return state;
}

async function joinChannel(channel, name) {
  return new Promise((resolve, reject) => {
    channel.join()
      .receive("ok", (msg) => {
        log(name, 'debug', `Connected to game: ${msg.game}`);
        resolve();
      })
      .receive("error", (err) => {
        console.error(`Failed to join channel (${name}):`, err);
        reject(err);
      });
  });
}

function handleView(state) {
  return (view) => {
    const viewId = JSON.stringify(view);
    // sometimes, a view will come in that just indicates a player joined and we want to process it twice
    if (view.players.length > state.lastPlayersLength) {
      onView(state, view);
      state.lastPlayersLength = view.players.length;
      return;
    }
    if (!state.processedViews.has(viewId)) {
      state.processedViews.add(viewId);
      onView(state, view);
    }
  };
}

async function joinChannels() {
  const state = await initChannels();

  state.channelSleeper.on("view", handleView(state));
  state.channelMain.on("view", handleView(state));

  try {
    state.socketSleeper.connect();
    await joinChannel(state.channelSleeper, NAME_SLEEPER);
    state.childConnected = true;

    state.socketMain.connect();
    await joinChannel(state.channelMain, NAME_MAIN);
    state.mainConnected = true;

  } catch (error) {
    console.error("Error joining channels:", error);
  }

  return state;
}

async function onView(state, view) {
  if (!isReadyToGuess(state))
    return;
  // console.log(view.active + `'s turn`);
  // calculateEnemyPoints(view);
  // console.log(isReadyToGuess(state));
  if (view.active === NAME_MAIN)
    onMainView(state, view);
  else if (view.active === NAME_SLEEPER)
    onSleeperView(state, view);
  else if (view.active === 'Eggman') // if eggman finishes
    finishedGame(state, view);
}

async function onSleeperView(state, view) {
  sleeperView = view;

  if (!isReadyToGuess(state)) {
    log(NAME_SLEEPER, 'debug', `Waiting for main client to connect...`);
    // return;
  }

  if (!view.puzzle.includes('-')) {
    log(NAME_SLEEPER, 'debug', "Done");
    finishedGame(state, view);
    return;
  }

  if (view.active !== NAME_SLEEPER) {
    log(NAME_SLEEPER, 'debug', "Not my turn");
    return;
  }

  const puzzle = view.puzzle;
  const guesses = new Set(view.guesses);
  const possibleMoves = Array.from(alphabet.difference(guesses));

  logTurnInfo(view, NAME_SLEEPER, possibleMoves);

  let ch = Array.from(sleeperPattern.difference(guesses))[0]; // next guess

  // only check once the sleeper guesses every vowel
  if (hasAllVowels(guesses)) {
    if (patternCouldFinishPuzzle(puzzle, guesses) && checkSleeperForEarlyFinish(possibleMoves, view.players)) {
      earlyFinishedGame(state, view);
      return;
    }
  }

  if (possibleMoves.length > 0) {
    log(NAME_SLEEPER, 'debug', `Guessing: ${ch}`);
    state.channelSleeper.push("guess", { ch: ch });
  }
}

async function onMainView(state, view) {
  mainView = view;

  if (!isReadyToGuess(state)) {
    log(NAME_MAIN, 'debug', "Waiting for sleeper client to connect...");
    return;
  }

  if (!view.puzzle.includes('-')) {
    log(NAME_MAIN, 'debug', "Done");
    finishedGame(state, view);
    return;
  }

  if (view.active !== NAME_MAIN) {
    log(NAME_MAIN, 'debug', "Not my turn");
    return;
  }

  const puzzle = view.puzzle;
  const guesses = new Set(view.guesses);
  const possibleMoves = Array.from(alphabet.difference(guesses));

  let patterns = puzzle.split(" ");

  let [rankedLetters, allCandidates] = filterAndRankCandidates(patterns, possibleMoves);

  log(NAME_MAIN, 'debug', `Predict: ${allCandidates.join(' ')}`);
  logTurnInfo(view, NAME_MAIN, possibleMoves);

  let chs = removeVowels(sortLettersByEnemyPriority(possibleMoves).join('')); // remove vowels because the sleeper agent always takes care of them

  if (chs.length === 0)
    chs = possibleMoves; // fallback that probably doesn't matter

  let ch = chs[chs.length - 1]; // we want more chances to go, so use the least frequent vowel
  if (rankedLetters.length !== 0)
    ch = rankedLetters[0];

  if (patternCouldFinishPuzzle(puzzle, guesses)) {
    if (checkMainPlayerForEarlyFinish(possibleMoves, view.players)) {
      earlyFinishedGame(state, view);
      return;
    }
  }

  if (possibleMoves.length > 0) {
    log(NAME_MAIN, 'debug', `Guessing: ${ch}`);
    state.channelMain.push("guess", { ch: ch });
  }
}

function earlyFinishedGame(state, view) {
  if (state.finished) // hacky
    return;

  console.log(clc.red(`[DNF] Game: ${view.game}`));
  console.log(clc.red(`Puzzle: ${view.puzzle}`));

  const playerNames = view.players.map(player => player.name);
  const playerScores = view.players.map(player => player.score);

  console.log(clc.red(playerNames.join(' vs. ') + ':'));
  console.log(clc.red(playerScores.join(' to ') + ' points\n'));

  // process.exit();
  // joinSleeper();

  state.finished = true;
  startNewGames();
}

function finishedGame(state, view) {
  if (state.finished) // both players get a finished view so we only the first one
    return;

  console.log(clc.green(`\n[Finished] Game: ${view.game}`));
  console.log(clc.green(`Puzzle: ${view.puzzle}`));

  const playerNames = view.players.map(player => player.name);
  const playerScores = view.players.map(player => player.score);

  console.log(clc.green(playerNames.join(' vs. ') + ':'));
  console.log(clc.green(playerScores.join(' to ') + ' points\n'));

  state.finished = true;
  startNewGames();
}

function isReadyToGuess(state) {
  if (state.childConnected && state.mainConnected) {
    // console.log("Both clients are connected");
    return true;
  }
  return false;
}

let activeGames = [];

async function startNewGames() {
  activeGames = activeGames.filter(game => !game.finished);

  if (activeGames.length < MAX_ACTIVE_GAMES) {

    let state = await joinChannels();
    activeGames.push(state);

  }
}

startNewGames();
