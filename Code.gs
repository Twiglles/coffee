function doGet() {
  return out_(read_());
}
function doPost(e) {
  var route = String(JSON.parse(e.postData.contents).route);
  if (!/^[1-5]$/.test(route)) return out_({error: 'route'});
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  var s = sheet_(), rows = s.getDataRange().getValues(), done = false;
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]) === route) {
      s.getRange(i + 1, 2).setValue(Number(rows[i][1]) + 1);
      done = true;
      break;
    }
  }
  if (!done) s.appendRow([route, 1]);
  lock.releaseLock();
  var c = read_();
  return out_({route: Number(route), total: c.counts[route]});
}
function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName('visits') || ss.insertSheet('visits');
}
function read_() {
  var counts = {}, rows = sheet_().getDataRange().getValues();
  for (var i = 0; i < rows.length; i++) if (rows[i][0] !== '') counts[String(rows[i][0])] = Number(rows[i][1]);
  return {counts: counts};
}
function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
