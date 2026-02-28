async function main() {
  const res = await fetch("http://localhost:3000/api/repos/1/commits?limit=2");
  console.log(await res.text());
}
main().catch(console.error);
