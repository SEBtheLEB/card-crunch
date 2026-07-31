import { existsSync, readdirSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const androidRoot = resolve(root, "android");
const gradleCommand = process.platform === "win32" ? "gradlew.bat" : "./gradlew";
const npmCli = process.env.npm_execpath;
const capacitorCli = resolve(root, "node_modules", "@capacitor", "cli", "bin", "capacitor");

if (!npmCli || !existsSync(npmCli)) throw new Error("Unable to locate the npm CLI for the release build.");
run(process.execPath, [npmCli, "run", "build:release"], root);
run(process.execPath, [capacitorCli, "sync", "android"], root);

const javaHome = findModernJavaHome();
if (!javaHome) {
  throw new Error(
    "Card Crunch Android release requires JDK 21 or newer. Set CARD_CRUNCH_JAVA_HOME or JAVA_HOME before building."
  );
}

const buildEnvironment = {
  ...process.env,
  JAVA_HOME: javaHome,
  PATH: `${join(javaHome, "bin")}${delimiter}${process.env.PATH || ""}`
};
run(gradleCommand, ["--stop"], androidRoot, buildEnvironment);
run(gradleCommand, ["bundleRelease"], androidRoot, buildEnvironment);
console.log(`Card Crunch Android release built with ${javaHome}`);

function findModernJavaHome() {
  const candidates = [
    process.env.CARD_CRUNCH_JAVA_HOME,
    process.env.JAVA_HOME,
    process.platform === "win32" ? "C:\\Program Files\\Android\\Android Studio\\jbr" : "",
    ...discoverWindowsJdks()
  ].filter(Boolean);
  return candidates.find((candidate) => getJavaMajor(candidate) >= 21) ?? "";
}

function discoverWindowsJdks() {
  if (process.platform !== "win32") return [];
  const roots = [
    "C:\\Program Files\\Eclipse Adoptium",
    "C:\\Program Files\\Java",
    "C:\\Program Files"
  ];
  const matches = [];
  for (const directory of roots) {
    if (!existsSync(directory)) continue;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && /^(jdk|temurin|zulu|microsoft)/i.test(entry.name)) {
        matches.push(join(directory, entry.name));
      }
    }
  }
  return matches;
}

function getJavaMajor(javaHome) {
  const executable = join(javaHome, "bin", process.platform === "win32" ? "java.exe" : "java");
  if (!existsSync(executable)) return 0;
  const result = spawnSync(executable, ["-version"], { encoding: "utf8" });
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  const match = output.match(/version "(?:1\.)?(\d+)/i);
  return Number(match?.[1]) || 0;
}

function run(command, args, cwd, env = process.env) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    stdio: "inherit",
    shell: process.platform === "win32" && /\.(?:cmd|bat)$/i.test(command)
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}.`);
  }
}
