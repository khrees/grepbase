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
  
  console.log('has then?', 'then' in result);
  console.log('has toDataStreamResponse?', 'toDataStreamResponse' in result);
  console.log('has toTextStreamResponse?', 'toTextStreamResponse' in result);

  // let's await it and see what it resolves to!
  const awaited = await (result as any);
  console.log('--- After await ---');
  console.log('awaited object type:', typeof awaited);
  console.log('has toDataStreamResponse after await?', awaited && 'toDataStreamResponse' in awaited);
  console.log('Keys of awaited:', Object.keys(awaited));
}

main().catch(console.error);
