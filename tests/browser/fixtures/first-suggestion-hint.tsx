import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FirstSuggestionHint } from '../../../app/first-suggestion-hint';
function Fixture() {
 const [eligible, setEligible] = useState(false);
 return <div><button onClick={() => setEligible(!eligible)}>Toggle suggestions</button><FirstSuggestionHint ownerEmail="fixture@test.invalid" eligible={eligible} /></div>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
