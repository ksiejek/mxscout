// A small but realistic Mendix Cloud live log that exercises every log tool — used by test/44-logs.test.js.
const P = '[runtime-container/abc123]';
const L = [];
let t = Date.parse('2026-07-18T09:00:00Z');
function ts(ms) { return new Date(t + ms).toISOString().replace('Z', '').replace(/\.(\d{3})/, '.$1000'); }
function add(ms, level, node, msg) { L.push(ts(ms) + ' ' + P + '  ' + level.padStart(5) + ' - ' + node + ': ' + msg); }
let ms = 0;
add(ms += 100, 'INFO', 'Core', 'Mendix Runtime started');
add(ms += 200, 'WARNING', 'WebUI', "User 'a@ex.com' attempted to execute runtime operation 'OP1' (microflow call 'Mod.ACT_Secret') but does not have the required permission.");
add(ms += 200, 'WARNING', 'WebUI', "User 'b@ex.com' attempted to execute runtime operation 'OP1' (microflow call 'Mod.ACT_Secret') but does not have the required permission.");
add(ms += 200, 'WARNING', 'RequestStatistics', 'Request state size of 450 objects exceeds the threshold of 300 objects.');
for (let i = 0; i < 6; i++) add(ms += 300, 'ERROR', 'TaskQueue', "Failed to execute task 'MDM.UPD_UserData(Account=X@" + i + ")' from task queue 'Queues.Schedule'.");
add(ms += 100, 'WARNING', 'ConnectionBus_Queries', 'Query executed in 2 seconds and 150 milliseconds: SELECT "a$b"."id" FROM "a$b" WHERE "a$b"."x" = 5');
add(ms += 100, 'ERROR', 'Connector', 'com.mendix.systemwideinterfaces.core.UserException: boom\n\tat com.mendix.A.run(A.java:10)\nCaused by: org.postgresql.util.PSQLException: ERROR: duplicate key value violates unique constraint "order_ordernumber_key"\n  Detail: Key (ordernumber)=(ORD-1) already exists.');
add(ms += 100, 'DEBUG', 'MicroflowEngine', "[1784268324436-46] Starting execution of microflow 'Sales.ACT_Save'");
add(ms += 10, 'TRACE', 'MicroflowEngine', '[1784268324436-46] Executing activity: {"current_activity":{"type":"RetrieveByXPath","caption":"Retrieve Orders"},"name":"Sales.ACT_Save"}');
add(ms += 10, 'TRACE', 'ConnectionBus_Retrieve', 'SQL@abc123(T1-Cabc): SELECT "sales$order"."id" FROM "sales$order" WHERE "sales$order"."status" = ?');
add(ms += 1, 'TRACE', 'ConnectionBus_Retrieve', 'SQL@abc123(T1-Cabc): Select params 1: 1');
add(ms += 1, 'TRACE', 'ConnectionBus_Retrieve', 'SQL@abc123(T1-Cabc): Success: 3 row(s)');
add(ms += 40, 'DEBUG', 'MicroflowEngine', "[1784268324436-46] Finished execution of microflow 'Sales.ACT_Save'");
add(ms += 100, 'TRACE', 'REST Consume', 'Request content for GET request to https://api.example.com/items?id=1\nAccept: application/json\n');
add(ms += 250, 'TRACE', 'REST Consume', 'Response content for GET request to https://api.example.com/items?id=1\nHTTP/1.1 200 OK\nContent-Type: application/json\n\n{"items":[1,2,3]}');
for (let i = 0; i < 20; i++) add(ms += 500, 'INFO', 'Core', 'heartbeat ' + i);
module.exports = L.join('\n') + '\n';
