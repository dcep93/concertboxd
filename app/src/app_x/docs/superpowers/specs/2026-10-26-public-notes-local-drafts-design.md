# Public notes local drafts

Approved by the user with `yesi` on October 26, 2026.

## Behavior

Editable Public Notes restores its local draft on page load. A draft is scoped to the authenticated user and concert using a versioned localStorage key. Empty strings are valid drafts. Without a draft, show the latest published notes. Read-only viewers only see published notes.

Typing updates React state immediately and writes the latest draft to localStorage after 300 ms without another edit. Flush pending writes on pagehide, when the document becomes hidden, and when the editor unmounts or changes identity. Cancel superseded timers.

Save continues to publish through the existing action. When the published snapshot matches the current draft, cancel pending writes and remove the local draft. Failed saves retain the draft. Text typed after a save begins remains a draft when that earlier save is acknowledged. Switching user or concert must never carry the previous draft into the next editor.

Unavailable or full localStorage must not prevent editing or publishing; persistence is best effort. Cross-tab live editing is outside this change.

## Implementation

Add a focused useNotesDraft hook beside useLogEditor. Keep storage access, debounce state, and lifecycle flushing together in that hook. Replace only the notes draft state in useLogEditor. Preserve the existing markup and publishing path.

## Verification

Use the existing in-memory owner-controls browser fixture and a small hook fixture for identity and delayed-save checks. Verify debounce timing, reload restoration, empty drafts, user/concert isolation, read-only isolation, unmount/pagehide flushing, successful publication cleanup, typing during a save, failed saves, and blocked storage. Run the production build, lint, and existing unit tests. Commit and push main to trigger deployment, then inspect the deployment result.

## Review

The design is limited to local drafts, specifies the storage lifecycle and publication boundary, and has no unresolved decisions.
