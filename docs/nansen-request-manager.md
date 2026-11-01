# Nansen request queue

Every call from the server to Nansen waits in one queue: `src/nansen/request-manager.ts`. The queue limits how many calls run at once and how fast new calls start. This stops sudden bursts of calls to the Nansen plan. It also keeps Uncle's chat from waiting behind a large background save.

In the code, "Iroh" means Uncle.

## Two lanes

The queue has two lanes:

- **Normal lane.** Every JSON call from the background save goes here: thesis seals, asset pages, and Shelf boards. Only the HTTP call waits in the queue. The work that builds a page from several calls does not.
- **Uncle lane.** Each Uncle message takes one place here. It holds the place until the answer has finished streaming.

The oldest waiting call in either lane starts next. An Uncle call waits while the Uncle lane is full (2 answers by default). So the normal lane always has room.

## Limits

| Setting                            | Default | Meaning                                                                                   |
| ---------------------------------- | ------: | ----------------------------------------------------------------------------------------- |
| `NANSEN_GLOBAL_MAX_CONCURRENT`     |       8 | Calls that run at the same time, in both lanes. Never below 2.                            |
| `NANSEN_IROH_MAX_CONCURRENT`       |       2 | Uncle answers that stream at the same time. Always at least 1 below the global limit.     |
| `NANSEN_REQUEST_STARTS_PER_SECOND` |       3 | New calls that can start each second, in both lanes                                       |
| `NANSEN_REQUEST_START_BURST`       |       6 | Calls that can start at once before the per-second limit applies                          |
| `NANSEN_NORMAL_MAX_QUEUE`          |      48 | Normal calls that can wait. One more gets "Nansen request queue is full."                 |
| `NANSEN_NORMAL_MAX_QUEUE_WAIT_MS`  |   20000 | The deadline for a normal call, counted from when it joins the queue                      |
| `NANSEN_IROH_MAX_QUEUE`            |       4 | Uncle messages that can wait. One more gets "Nansen Research queue is full."              |
| `NANSEN_IROH_MAX_QUEUE_WAIT_MS`    |   15000 | The deadline for an Uncle message, counted from when it joins the queue                   |
| `NANSEN_JSON_MAX_RETRIES`          |       1 | How often a failed normal call is tried again. `0` turns retries off.                     |
| `NANSEN_JSON_RETRY_BASE_DELAY_MS`  |     500 | The pause before a retry, varied by 25% either way. A 429 retry waits for Nansen instead. |

A value that is not a positive number falls back to the default. `NANSEN_JSON_MAX_RETRIES` takes any whole number from 0 up. An empty value counts as 0 and turns retries off.

These defaults are careful guesses. The repo holds no measurement of the Nansen plan's real capacity.

## Deadlines

Each call gets its deadline when it joins the queue. If it has not started by then, it fails with "Nansen request waited too long." A call that has started never hits this deadline. The 15-second HTTP timeout ends it instead. An Uncle answer has its own limit of 90 seconds.

A retry must also start before the same deadline. So the first try and the pause before the retry use up the call's time. With the defaults, a call that waited more than about 4.5 seconds in the queue gets no retry after its first try times out.

## Retries and rate limits

The server tries a normal call again after a timeout, a network error, HTTP 429 (too many requests), or HTTP 500, 502, 503, or 504. It does not retry other errors. It never retries an Uncle message. The visitor can press **Try again**.

When Nansen answers 429 to a call made with the house key, in either lane, every new call waits. The pause lasts as long as Nansen's `Retry-After` header says, or 1 second when the header is missing. A 429 on an Uncle message sent with a visitor's own key pauses nothing, because that key has its own limit.

## Shared calls

Two identical normal calls (same endpoint, same JSON body) share one request while it waits, runs, or waits to retry. When the request finishes, the sharing ends. The next identical call makes a new request. If one caller gives up, the request goes on for the others.

## Scope

All limits, lanes, and pauses live inside one server process. Two server processes do not know about each other. This is one reason the shop runs as one process on Railway. The SQLite database, the background save, and the free-message count need one process too.

The queue does not decide what to save or when. The background save does. See [Saved readings](how-it-works.md#saved-readings).
