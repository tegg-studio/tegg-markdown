import {expect, test} from "@playwright/test";

test.beforeEach(async ({page}) => {
  await page.route("**/recovery-harness", route => route.fulfill({contentType: "text/html", body: "<!doctype html><title>Recovery storage fixture</title>"}));
  await page.goto("/recovery-harness");
});

test("IndexedDB checkpoints survive a page restart and damaged newest data is quarantined", async ({page}, info) => {
  const databaseName = `recovery-fixture-${info.project.name}-${Date.now()}`;
  const written = await page.evaluate(async databaseName => {
    const api = await import("/src/recoveryJournal.ts");
    const storage = new api.IndexedDBRecoveryStorage(databaseName);
    const journal = new api.RecoveryJournal(storage);
    journal.schedule({documentId: "fixture.md", generation: "page-one", sequence: 1,
      baseRevision: "disk-1", baseSource: "# Base\r\n", draftSource: "# 中😀 draft\r\n",
      encoding: "utf-8", bom: true, newline: "crlf", reason: "conflict"});
    const records = await journal.flush();
    await journal.dispose(); await storage.close();
    return {checksum: records[0].checksum, recordId: records[0].recordId};
  }, databaseName);
  await page.reload();
  const reopened = await page.evaluate(async databaseName => {
    const api = await import("/src/recoveryJournal.ts");
    const storage = new api.IndexedDBRecoveryStorage(databaseName);
    const journal = new api.RecoveryJournal(storage);
    const before = await journal.read("fixture.md");
    const previous = before.records[0];
    const corrupt = await api.createRecoveryRecord({...previous, sequence: 2, draftSource: "damaged latest"});
    await storage.put(api.recoveryStorageKey(corrupt), JSON.stringify({...corrupt, draftSource: "checksum does not match"}));
    const after = await journal.read("fixture.md");
    const quarantined = await storage.quarantined();
    await journal.dispose(); await storage.close();
    return {before, after, quarantined};
  }, databaseName);
  expect(reopened.before.records[0].checksum).toBe(written.checksum);
  expect(reopened.before.records[0].recordId).toBe(written.recordId);
  expect(reopened.after.records.map(record => record.draftSource)).toEqual(["# 中😀 draft\r\n"]);
  expect(reopened.after.quarantined[0].reason).toBe("checksum-mismatch");
  expect(reopened.quarantined).toHaveLength(1);
  expect(reopened.after.failures).toEqual([]);
});

test("IndexedDB retains unresolved checkpoints until an exact Host save receipt", async ({page}, info) => {
  const result = await page.evaluate(async databaseName => {
    const api = await import("/src/recoveryJournal.ts");
    const storage = new api.IndexedDBRecoveryStorage(databaseName), journal = new api.RecoveryJournal(storage);
    journal.schedule({documentId: "fixture.md", generation: "page", sequence: 3,
      baseRevision: "old", baseSource: "base", draftSource: "unsaved work", encoding: "utf-8", bom: false, newline: "lf", reason: "save-failed"});
    const [record] = await journal.flush();
    const receipt = {documentId: "fixture.md", generation: "page", sequence: 3, baseRevision: "old", source: "unsaved work", revision: "new"};
    const rejected = await journal.removeResolved(record, {...receipt, generation: "another page"});
    const protectedCount = (await journal.read()).records.length;
    const accepted = await journal.removeResolved(record, receipt);
    const afterCount = (await journal.read()).records.length;
    await journal.dispose(); await storage.close();
    return {rejected, protectedCount, accepted, afterCount};
  }, `recovery-receipt-${info.project.name}-${Date.now()}`);
  expect(result).toEqual({rejected: false, protectedCount: 1, accepted: true, afterCount: 0});
});
