import test from 'node:test';
import assert from 'node:assert/strict';
import { requiresResourceReservationCheck, requiresStaffReservationCheck, removedSkillIds } from '../apps/api/src/services/master-data-guards.ts';

test('renaming equipment is safe, but deactivation and type change must check booked customers', () => {
  const existing = { active: true, type: 'nail_table' };
  assert.equal(requiresResourceReservationCheck(existing, { name: 'VIP nail table' }), false);
  assert.equal(requiresResourceReservationCheck(existing, { type: 'nail_table', active: true }), false);
  assert.equal(requiresResourceReservationCheck(existing, { active: false }), true);
  assert.equal(requiresResourceReservationCheck(existing, { type: 'lash_bed' }), true);
  assert.equal(requiresResourceReservationCheck({ active: false, type: 'chair' }, { active: true }), false);
});

test('staff deactivation needs a booking check, while editing staff profile or reactivation does not', () => {
  assert.equal(requiresStaffReservationCheck({ active: true }, { active: false }), true);
  assert.equal(requiresStaffReservationCheck({ active: true }, { name: 'new name' }), false);
  assert.equal(requiresStaffReservationCheck({ active: false }, { active: true }), false);
  assert.equal(requiresStaffReservationCheck({ active: false }, { active: false }), false);
});

test('skill removal is the set difference (no false positives on additions or reorder)', () => {
  assert.deepEqual(removedSkillIds(['nail', 'lash', 'lash'], ['nail']), ['lash']);
  assert.deepEqual(removedSkillIds(['lash', 'nail'], ['nail', 'lash', 'beauty']), []);
  assert.deepEqual(removedSkillIds([], []), []);
  assert.deepEqual(removedSkillIds(['lash'], []), ['lash']);
});

import { requiresServiceReservationCheck } from '../apps/api/src/services/master-data-guards.ts';

test('service label/price/duration edits keep booked snapshots; disabling or equipment switch needs conflict guard', () => {
  const svc = { active:true, resourceType:'nail_table' };
  assert.equal(requiresServiceReservationCheck(svc, { nameZh:'新名称',priceJpy:9900, durationMinutes:90 }), false);
  assert.equal(requiresServiceReservationCheck(svc, { active:false }), true);
  assert.equal(requiresServiceReservationCheck(svc, { resourceType:'lash_bed' }), true);
  assert.equal(requiresServiceReservationCheck(svc, { resourceType:null }), true);
  assert.equal(requiresServiceReservationCheck(svc, { resourceType:'nail_table' }), false);
  assert.equal(requiresServiceReservationCheck({ active:false, resourceType:null }, { active:true }), false);
});
