import assert from "node:assert/strict";
import test from "node:test";
import { nextAfterDelivery, nextOccurrence, validateDefinition, type ScheduleDefinition } from "../lib/schedules/timing";

const daily: ScheduleDefinition = { title: "Call Dad", kind: "reminder", instructions: "Call Dad", timeZone: "America/Toronto", firstRunAt: null, recurrence: { type: "cron", expression: "0 9 * * *" }, endAt: null, scheduleLabel: "Every day at 9 AM", notifyPolicy: "always" };

test("daily reminders retain their local hour across spring and fall DST", () => {
  const recurrence = daily.recurrence!;
  assert.equal(nextOccurrence(recurrence,"America/Toronto",new Date("2026-03-07T14:00:00Z"),new Date()).toISOString(),"2026-03-08T13:00:00.000Z");
  assert.equal(nextOccurrence(recurrence,"America/Toronto",new Date("2026-10-31T13:00:00Z"),new Date()).toISOString(),"2026-11-01T14:00:00.000Z");
});
test("one-time dates must be future, offset-bearing and in a valid timezone", () => {
  const now=new Date("2026-09-06T12:00:00Z");
  assert.throws(()=>validateDefinition({...daily,recurrence:null,firstRunAt:"2026-09-06T13:00:00"},now),/offset/);
  assert.throws(()=>validateDefinition({...daily,recurrence:null,firstRunAt:"2026-09-06T11:00:00Z"},now),/past/);
  assert.throws(()=>validateDefinition({...daily,timeZone:"Moon/Base"},now),/timezone/);
  assert.equal(validateDefinition({...daily,recurrence:null,firstRunAt:"2026-09-06T09:00:00-04:00"},now).firstRunAt,"2026-09-06T13:00:00.000Z");
});
test("weekday and month-end schedules calculate the next real occurrence",()=>{
  assert.equal(nextOccurrence({type:"cron",expression:"0 9 * * 1-5"},"America/Toronto",new Date("2026-09-04T14:00:00Z"),new Date()).toISOString(),"2026-09-07T13:00:00.000Z");
  assert.equal(nextOccurrence({type:"cron",expression:"0 9 L * *"},"UTC",new Date("2026-02-01T00:00:00Z"),new Date()).toISOString(),"2026-02-28T09:00:00.000Z");
});
test("an outage coalesces missed occurrences rather than sending a backlog",()=>{
  const definition=validateDefinition(daily,new Date("2026-09-01T00:00:00Z"));
  assert.equal(nextAfterDelivery(definition,new Date(definition.firstRunAt),new Date("2026-09-06T20:00:00Z"))?.toISOString(),"2026-09-07T13:00:00.000Z");
  assert.equal(nextAfterDelivery({...definition,recurrence:null},new Date(definition.firstRunAt),new Date()),null);
});
test("interval cadence is anchored and end dates stop recurring work",()=>{
  const definition=validateDefinition({...daily,recurrence:{type:"interval",minutes:120},firstRunAt:"2026-09-06T13:00:00Z",endAt:"2026-09-06T17:00:00Z"},new Date("2026-09-06T12:00:00Z"));
  assert.equal(nextAfterDelivery(definition,new Date("2026-09-06T13:00:00Z"),new Date("2026-09-06T15:30:00Z"))?.toISOString(),"2026-09-06T17:00:00.000Z");
  assert.equal(nextAfterDelivery(definition,new Date("2026-09-06T17:00:00Z"),new Date("2026-09-06T17:00:00Z")),null);
});
test("conflicting cron/first dates and quiet reminders are rejected",()=>{
  const now=new Date("2026-09-06T12:00:00Z");
  assert.throws(()=>validateDefinition({...daily,firstRunAt:"2026-09-06T14:00:00Z"},now),/does not match/);
  assert.throws(()=>validateDefinition({...daily,notifyPolicy:"when_relevant"},now),/always deliver/);
  assert.throws(()=>validateDefinition({...daily,recurrence:{type:"cron",expression:"* * * * * *"}},now),/five-field/);
});
