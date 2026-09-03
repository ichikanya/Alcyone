"use strict";

var fs = require("fs");
var path = require("path");
var childProcess = require("child_process");

var testsDir = __dirname;
var files = fs.readdirSync(testsDir).filter(function (f) {
  return f.endsWith(".test.js");
});

console.log("Running " + files.length + " test suites...\n");
var failed = [];

files.forEach(function (file) {
  var fullPath = path.join(testsDir, file);
  try {
    childProcess.execSync('node "' + fullPath + '"', { stdio: "inherit" });
    console.log("PASS: " + file);
  } catch (e) {
    console.error("FAIL: " + file);
    failed.push(file);
  }
});

if (failed.length) {
  console.error("\n" + failed.length + " tests failed: " + failed.join(", "));
  process.exit(1);
} else {
  console.log("\nALL TESTS PASSED SUCCESSFULLY!");
}
