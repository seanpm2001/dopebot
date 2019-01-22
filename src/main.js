const Discord = require("discord.js");
const { exec } = require("child_process");
const { fromEventPattern, of } = require("rxjs");
const {
  filter,
  groupBy,
  map,
  mergeMap,
  share,
  throttleTime
} = require("rxjs/operators");
require("dotenv").config();

const JS = /`{3}js?([\s\S]*)`{3}/;
const HELP = /^\?h[ea]lp$/;
const EVAL = /^\?eval/;

const discordObservable = (discordClient, eventName) =>
  share()(fromEventPattern(discordClient.on.bind(discordClient, eventName)));
const throttleKey = (keySelector, duration) => observable =>
  mergeMap(obs => obs.pipe(throttleTime(duration)))(
    groupBy(keySelector)(observable)
  );

const messageOptions = { code: "js" };
const bashOptions = { timeout: 2000, shell: "/bin/bash" };
const bashCommand = code =>
  `deno <( echo -e "['libdeno','deno','compilerMain'].forEach(p=>delete window[p]);console.log(eval(atob('${code}')))" )`;
const formatResponse = (error, stdout) => {
  if (error && error.killed) {
    return "That took too long (2s)";
  }

  if (error) {
    return error.message.split(/\r?\n/)[1];
  }

  if (stdout.length > 500) {
    return "tl;dr";
  }

  return stdout;
};
const doTheThing = message =>
  of(message).pipe(
    map(msg => msg.content.match(JS)),
    filter(matches => Array.isArray(matches) && matches.length === 2),
    map(matches => matches[1]),
    map(code => Buffer.from(code).toString("base64")),
    map(bashCommand),
    mergeMap(command =>
      fromEventPattern(exec.bind(undefined, command, bashOptions))
    ),
    map(result => result.concat(message))
  );

const client = new Discord.Client();

const message$ = discordObservable(client, "message");
const messageUpdate$ = discordObservable(client, "messageUpdate");

const resultLog = {};

const addResultToLog = res => {
  resultLog[message.id] = res;
};

message$
  .pipe(filter(message => HELP.test(message.content)))
  .subscribe(message => {
    message.channel.send(
      "Need some help evaluating your hacky code? Ooof. Send a message like\n?eval\n\\```js\nput your code here\n\\```"
    );
  });

message$
  .pipe(
    filter(message => EVAL.test(message.content)),
    throttleKey(message => message.author.id, 30 * 1000),
    mergeMap(doTheThing)
  )
  .subscribe(([error, stdout, stderr, message]) => {
    console.log(error, stdout, stderr, message.content);
    message.channel
      .send(formatResponse(error, stdout), messageOptions)
      .then(addResultToLog);
  });

messageUpdate$
  .pipe(
    filter(messages => messages[0].id in resultLog),
    map(messages => messages[1]),
    mergeMap(doTheThing)
  )
  .subscribe(([error, stdout, stderr, message]) => {
    console.log(error, stdout, stderr, message.content);
    resultLog[message.id]
      .edit(formatResponse(error, stdout), messageOptions)
      .then(addResultToLog);
  });

client.login(process.env.BOT_TOKEN);
