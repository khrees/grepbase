async function fetchStream() {
  const response = await fetch('http://localhost:3000/api/explain', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'question',
      repoId: 1,
      question: 'What is this repo?',
      provider: {
        type: 'ollama',
        model: 'llama3',
        baseUrl: 'http://localhost:11434/v1',
        apiKey: 'ollama'
      }
    })
  });

  const reader = response.body?.getReader();
  if(!reader) return;

  const decoder = new TextDecoder();
  let chunks = 0;
  while(true) {
      const {done, value} = await reader.read();
      if(done) break;
      const chunk = decoder.decode(value);
      console.log(`--- CHUNK ${chunks++} ---`);
      console.log(chunk);
      console.log(`JSON parsed line-by-line:`);
      const lines = chunk.split('\n');
      for (const line of lines) {
          if (line.startsWith('0:')) {
              try {
                  console.log(JSON.parse(line.slice(2)));
              } catch(e) {}
          }
      }
  }
}

fetchStream().catch(console.error);
