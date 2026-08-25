"use strict";

/* Node 0.12 predates `node --check`, so parse service sources with Function. */

var fs = require("fs");
var path = require("path");
var root = path.join(__dirname, "..", "app", "service");
var files = [];
var failed = [];

function walk(directory) {
  var entries = fs.readdirSync(directory);
  var i, full, stat;
  for (i = 0; i < entries.length; i++) {
    full = path.join(directory, entries[i]);
    stat = fs.statSync(full);
    if (stat.isDirectory()) walk(full);
    else if (/\.js$/.test(entries[i])) files.push(full);
  }
}

walk(root);
files.forEach(function (file) {
  try {
    /* Function parses the same ES grammar without executing service startup. */
    new Function(fs.readFileSync(file, "utf8"));
  } catch (error) {
    failed.push(path.relative(root, file) + ": " + error.message);
  }
});

if (failed.length) {
  failed.forEach(function (failure) {
    console.error("FAIL - " + failure);
  });
  process.exit(1);
}
console.log("ok   - Node 0.12.2 parsed " + files.length + " service files");
