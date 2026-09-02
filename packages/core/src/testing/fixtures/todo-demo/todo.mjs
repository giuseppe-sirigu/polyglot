#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FILE = new URL("./todos.json", import.meta.url);
const load = () => (existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : []);
const save = (t) => writeFileSync(FILE, JSON.stringify(t, null, 2));

const [cmd, ...rest] = process.argv.slice(2);
const todos = load();

switch (cmd) {
  case "add":
    todos.push({ text: rest.join(" "), done: false });
    save(todos);
    console.log(`Added: ${rest.join(" ")}`);
    break;
  case "done":
    todos[Number(rest[0])].done = true;
    save(todos);
    console.log(`Marked #${rest[0]} done`);
    break;
  case "list":
    todos.forEach((t, i) => console.log(`${i}. [${t.done ? "x" : " "}] ${t.text}`));
    break;
  default:
    console.log("usage: todo <add|done|list>");
}
