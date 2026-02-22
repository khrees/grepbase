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
  
  console.log('Is result a promise?', result instanceof Promise);
  console.log('typeof result:', typeof result);
  console.log('Keys of result:', Object.keys(result));
  console.log('typeof result.toDataStreamResponse:', typeof (result as any).toDataStreamResponse);
  console.log('typeof result.toTextStreamResponse:', typeof (result as any).toTextStreamResponse);
}

main().catch(console.error);
