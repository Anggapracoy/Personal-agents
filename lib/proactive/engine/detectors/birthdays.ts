import { getLifeProfile } from '../../../life-profile';
import { localClock } from '../rules';
import { engineDecision } from '../cards';
import { addCandidates, publishDecisions } from '../store';

function daysBetween(fromDate: string, toDate: string) {
  return Math.round((Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / 86_400_000);
}

/** Birthdays come from Contacts on the phone (names and dates only) and publish as soon as discovered. */
export async function birthdayCandidates(ownerEmail: string, birthdays: Array<{ name: string; date: string }>, now = new Date()) {
  if (!birthdays.length) return 0;
  const life = await getLifeProfile(ownerEmail);
  const today = localClock(life.profile?.timeZone, now).localDate;
  const soon = birthdays.flatMap(person => {
    const days = daysBetween(today, person.date);
    return days === 0 || days === 1 ? [{ ...person, days }] : [];
  });
  if (!soon.length) return 0;
  const cards = soon.map(person => {
    const first = person.name.split(/\s+/)[0]!;
    return engineDecision({
      ownerEmail, kind: 'birthday', key: `${person.name.toLowerCase()}:${person.date}`, category: 'family',
      title: person.days === 0 ? `${first}’s birthday today` : `${first}’s birthday tomorrow`,
      body: person.days === 0 ? `It’s ${person.name}’s birthday today. Want help sending something?` : `${person.name}’s birthday is tomorrow. Want me to help plan something?`,
      why: [`${person.name}’s birthday is saved in your Contacts.`],
      context: { birthdayPerson: person.name, birthdayDate: person.date },
      options: [
        { label: 'Draft a message', sublabel: `Write a short, warm birthday message to ${person.name} for my review.`, actionType: 'approval' },
        { label: 'Find a gift', sublabel: `Suggest a few thoughtful gift ideas for ${person.name} that can arrive in time.`, actionType: 'research' },
      ],
      actionableUntil: new Date(Date.parse(`${person.date}T23:59:00Z`) + 12 * 3_600_000), now,
    });
  });
  await publishDecisions(ownerEmail, () => cards);
  return addCandidates(ownerEmail, cards.map(card => ({
    kind: 'birthday', dedupeKey: `birthday:${card.id}`, decisionId: card.id,
    title: card.title, body: card.subtitle, payload: { notificationId: card.id, category: card.category },
  })));
}
