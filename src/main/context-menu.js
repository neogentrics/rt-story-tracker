// What a right-click in text offers, outside the lists, which have a menu of their own. Spelling fixes come first, then cut, copy, paste
// and select all, and on the writing page what can be done with the words there. Nothing to type in and nothing selected means no menu.

// `params` is what Electron says was right-clicked. `onPage` is whether it was the writing page. `replace` and `learn` fix a spelling,
// and `send` asks the window to do something.
function contextTemplate(params, { onPage = false, replace, learn, send }) {
  const selected = Boolean(params.selectionText?.trim());
  if (!params.isEditable) return selected ? [{ role: 'copy' }] : [];

  const word = params.misspelledWord;
  const fixes = (params.dictionarySuggestions ?? []).map((fix) => ({ label: fix, click: () => replace(fix) }));
  const add = word ? [{ label: `Add “${word}” to Dictionary`, click: () => learn(word) }] : [];
  return [
    ...fixes,
    ...add,
    ...(fixes.length || word ? [{ type: 'separator' }] : []),
    { role: 'cut', enabled: params.editFlags.canCut },
    { role: 'copy', enabled: params.editFlags.canCopy },
    { role: 'paste', enabled: params.editFlags.canPaste },
    { type: 'separator' },
    { role: 'selectAll' },
    ...(onPage
      ? [
        { type: 'separator' },
        { label: 'Comment on the Selected Words', enabled: selected, click: () => send('context-comment') },
        { label: 'Find and Replace…', click: () => send('replace') },
      ]
      : []),
  ];
}

module.exports = { contextTemplate };
