import test from 'node:test';
import assert from 'node:assert/strict';
import { validWeeklyHours, narrowsBusinessHours, violatesBusinessHours } from '../apps/api/src/services/store-hours-guards.ts';

const week = Array.from({length:7}, (_,i)=>({ weekday:i+1, openTime:'10:00', closeTime:'20:00', isClosed:false }));

test('exactly seven unique ISO weekdays, no duplicate or omitted day', () => {
  assert.equal(validWeeklyHours(week), true);
  assert.equal(validWeeklyHours(week.slice(0,6)), false);
  assert.equal(validWeeklyHours([...week.slice(0,6), week[0]]), false);
  assert.equal(validWeeklyHours([...week.slice(0,6), {...week[6],weekday:8}]), false);
});

test('open hours reject overnight/reversed windows; a closed day preserves its dormant clock values', () => {
  assert.equal(validWeeklyHours(week.map((h,i)=> i===0 ? {...h,openTime:'21:00',closeTime:'09:00'} :h)), false);
  assert.equal(validWeeklyHours(week.map((h,i)=> i===0 ? {...h,openTime:'20:00',closeTime:'20:00'} :h)), false);
  assert.equal(validWeeklyHours(week.map((h,i)=> i===0 ? {...h,isClosed:true,openTime:'20:00',closeTime:'20:00'} :h)), true);
  assert.equal(validWeeklyHours(week.map((h,i)=> i===0 ? {...h,openTime:'24:00'}:h)), false);
});

test('only narrowing or closing open hours requires checking future customers', () => {
  const old = week[0];
  assert.equal(narrowsBusinessHours(old,{...old,openTime:'09:00',closeTime:'21:00'}), false);
  assert.equal(narrowsBusinessHours(old,{...old,openTime:'11:00'}), true);
  assert.equal(narrowsBusinessHours(old,{...old,closeTime:'19:00'}), true);
  assert.equal(narrowsBusinessHours(old,{...old,isClosed:true}), true);
  assert.equal(narrowsBusinessHours({...old,isClosed:true}, {...old,isClosed:false}), false);
  assert.equal(narrowsBusinessHours(undefined, old), false);
});

test('only customer service time, not cleanup buffer, constrains business hours', () => {
  assert.equal(violatesBusinessHours({startTime:'10:00',customerEndTime:'20:00'},week[0]), false);
  assert.equal(violatesBusinessHours({startTime:'09:59',customerEndTime:'18:00'},week[0]), true);
  assert.equal(violatesBusinessHours({startTime:'11:00',customerEndTime:'20:01'},week[0]), true);
  assert.equal(violatesBusinessHours({startTime:'11:00',customerEndTime:'12:00'},{...week[0],isClosed:true}), true);
});
