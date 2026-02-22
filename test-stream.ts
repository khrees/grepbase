import { streamText } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

async function main() {
  const ollama = createOpenAICompatible({
    name: 'ollama',
    baseURL: 'http://localhost:11434/v1',
    apiKey: 'ollama',
  });
  
  const model = ollama('llama3');
  
  const result = streamText({
    model,
    prompt: 'hello'
  });
  
  const response = result.toTextStreamResponse();
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

main().catch(console.error);
