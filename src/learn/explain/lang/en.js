/**
 * English. Every other language file has the same keys.
 * {placeholders} are filled from the error; a sentence whose detail is
 * missing is left out, so keep each sentence self-contained.
 */
export default {
  ui: {
    heading: 'What went wrong',
    why: 'Why',
    fix: 'How to fix it',
    line: 'Line {line}',
    didYouMean: "Did you mean '{suggest}'?",
    explainIn: 'Explain in',
    hide: 'Hide',
    showOriginal: 'Python said',
    explainAll: 'Explain to everyone',
    fromTeacher: 'From your teacher',
  },
  rules: {
    name: {
      title: "Python doesn't know the name '{name}'",
      why: "'{name}' is used on line {line}, but nothing called '{name}' was created before that line. A typo, a missing quote around text, or using a variable before giving it a value all cause this.",
      fix: "Check the spelling of '{name}' (capital letters matter). If it is text, put it in quotes: \"{name}\". If it is a variable, give it a value earlier, e.g. {name} = 0.",
    },
    unbound: {
      title: "'{name}' is used before it gets a value in this function",
      why: "Inside the function you assign to '{name}', so Python treats it as the function's own variable, but line {line} reads it before that assignment.",
      fix: "Give '{name}' a value at the start of the function, or pass it in as a parameter.",
    },
    zero: {
      title: 'Dividing by zero',
      why: 'On line {line} a number is divided by 0 (with /, // or %). That has no answer, so Python stops.',
      fix: 'Check the value you divide by before dividing, e.g. if count != 0: average = total / count',
    },
    index: {
      title: 'Position outside the {kind}',
      why: 'Line {line} asks for a position the {kind} does not have. Positions start at 0, so a {kind} of length 3 has positions 0, 1 and 2 only.',
      fix: 'Print len() of the {kind} and the position you use. For the last item use [-1]. In loops use range(len(...)) so the position never goes past the end.',
    },
    'index-pop': {
      title: 'Taking an item from an empty list',
      why: 'pop() on line {line} was called when the list had nothing left in it.',
      fix: 'Check the list first: if my_list: item = my_list.pop()',
    },
    key: {
      title: 'The key {key} is not in the dictionary',
      why: 'Line {line} looks up {key}, but the dictionary has no such key. Keys must match exactly, including capital letters and spaces.',
      fix: 'Print the dictionary\'s keys() to see what is there. Use .get({key}) to get None instead of an error, or check first with: if {key} in my_dict:',
    },
    concat: {
      title: 'Joining text and a number with +',
      why: "Line {line} uses + between a {a} and an {b}. Python will not guess whether you want to add numbers or join text.",
      fix: 'Turn the number into text with str(...), e.g. "Score: " + str(score), or put the number inside an f-string.',
    },
    operand: {
      title: "'{op}' does not work between {a} and {b}",
      why: "Line {line} uses {op} on a {a} and a {b}. Values read with input() are always text (str), even when the user types a number.",
      fix: 'Convert first: int(...) or float(...) for numbers, str(...) for text.',
    },
    compare: {
      title: "Comparing a {a} with a {b}",
      why: "Line {line} compares a {a} and a {b} with '{op}'. Python cannot say which is bigger.",
      fix: 'Make both the same type first, e.g. int(age) < 18. Remember: input() gives text.',
    },
    'not-callable': {
      title: "A {obj} is used like a function",
      why: "Line {line} puts ( ) after something that is a {obj}, not a function. Often a variable has the same name as a function (like sum = 0 and then sum(...)), or a * is missing: 2(x+1).",
      fix: 'Rename the variable so it does not hide the function, or write the multiplication sign: 2*(x+1).',
    },
    'none-subscript': {
      title: 'Using [ ] on None',
      why: "On line {line} the value is None. Many functions that change a list (sort, append) return None instead of the list.",
      fix: 'Use the list itself after calling sort(): nums.sort() then nums[0], or use sorted(nums)[0].',
    },
    'not-subscriptable': {
      title: "A {obj} can't be indexed with [ ]",
      why: "Line {line} uses [ ] on a {obj}. Only things like lists, strings and dictionaries have items inside.",
      fix: "Check that the variable holds the list or text you expect: print(type(...)).",
    },
    'not-iterable': {
      title: "Looping over a {obj}",
      why: "Line {line} tries to go through a {obj} item by item, but it is a single value.",
      fix: 'To repeat n times use: for i in range(n):',
    },
    'missing-arg': {
      title: '{func}() needs more values',
      why: "{func}() was called on line {line} without {arg}. Every parameter in the def line needs a value when you call it.",
      fix: 'Pass a value for {arg} in the call, or give it a default in the def line: def {func}(..., {arg}=0)',
    },
    'too-many-args': {
      title: '{func}() got too many values',
      why: '{func}() takes {expected} value(s) but line {line} gives it {got}. Inside a class, remember that self counts as one.',
      fix: 'Remove the extra values from the call, or add parameters to the def line.',
    },
    'list-indices': {
      title: 'Using {got} as a {kind} position',
      why: "Line {line} uses a {got} inside [ ] on a {kind}. Positions must be whole numbers.",
      fix: 'Convert it with int(...). In a for loop over a list, the loop variable is the item itself, not its position.',
    },
    unhashable: {
      title: 'A {obj} cannot be a dictionary key or set item',
      why: 'Line {line} uses a {obj} as a key. Keys must not change, and a {obj} can change.',
      fix: 'Use a tuple instead of a list: tuple(my_list).',
    },
    'str-int': {
      title: 'Text used where a whole number is needed',
      why: 'Line {line} gives text to something that needs a number, like range().',
      fix: 'Convert with int(...), e.g. range(int(n)).',
    },
    'int-literal': {
      title: "'{text}' is not a whole number",
      why: "int() on line {line} got '{text}'. It only works on text that is a whole number, like '42'.",
      fix: "Check what was typed. For decimals use float(...). To stop the program crashing on bad input, use try: ... except ValueError:",
    },
    'float-convert': {
      title: "'{text}' is not a number",
      why: "float() on line {line} got '{text}', which is not a number.",
      fix: 'Remove extra characters first (spaces, commas, %) or check the input before converting.',
    },
    'unpack-many': {
      title: 'More values than variables',
      why: 'Line {line} gives values to {expected} variable(s), but there are more values than that.',
      fix: 'Add variables on the left, or use one variable for the rest: a, *rest = values',
    },
    'unpack-few': {
      title: 'Fewer values than variables',
      why: 'Line {line} expects {expected} values but there are only {got}.',
      fix: 'Use as many variables as there are values. Print the values to see how many there are.',
    },
    'math-domain': {
      title: 'A maths function got a value it cannot use',
      why: 'Line {line} asks for something like the square root or log of a negative number (or log of 0).',
      fix: 'Check the value first, e.g. if x >= 0: math.sqrt(x)',
    },
    'none-attr': {
      title: "None has no '{attr}'",
      why: "On line {line} the value is None, so .{attr} cannot be used. A function without return gives None, and so do append(), sort() and similar.",
      fix: 'Make sure the function returns a value, and do not assign the result of append() or sort().',
    },
    attr: {
      title: "A {obj} has no '{attr}'",
      why: "Line {line} uses .{attr} on a {obj}, which does not have it.",
      fix: "Check the spelling, and that the variable holds what you expect. dir(...) lists everything a value has.",
    },
    'module-attr': {
      title: "The module {module} has no '{attr}'",
      why: "Line {line} uses {module}.{attr}, which does not exist. A file of yours named {module}.py may also hide the real module.",
      fix: 'Check the spelling and the documentation. Rename any file of yours called {module}.py.',
    },
    'no-module': {
      title: "The package '{module}' is not installed",
      why: "Line {line} imports {module}, but the Python you are using does not have it.",
      fix: "Install it: type {module} in the pip install box (some packages have a different install name, e.g. cv2 → opencv-python, sklearn → scikit-learn).",
    },
    'import-name': {
      title: "'{name}' cannot be imported",
      why: "Line {line} imports {name}, but that module has no such name (or two files import each other).",
      fix: 'Check the spelling and capital letters. If both files import each other, move the shared code to a third file.',
    },
    'syntax-colon': {
      title: 'A colon : is missing',
      why: 'Line {line} starts a block (if, for, while, def, class, else …) but does not end with :',
      fix: 'Add : at the end of the line, e.g. if x > 5:',
    },
    'syntax-unclosed': {
      title: "A '{bracket}' is never closed",
      why: "A '{bracket}' opened on line {line} has no matching closing bracket.",
      fix: 'Count the brackets on that line and the lines after it. Each ( needs ), each [ needs ], each { needs }.',
    },
    'syntax-unmatched': {
      title: "An extra or wrong closing '{bracket}'",
      why: "Line {line} closes a bracket that was never opened, or closes it with the wrong kind.",
      fix: 'Match each closing bracket with its opening one.',
    },
    'syntax-string': {
      title: 'Text is missing its closing quote',
      why: 'Text on line {line} starts with a quote but does not end with the same quote.',
      fix: "End the text with the same quote it starts with: 'like this' or \"like this\".",
    },
    'syntax-equals': {
      title: '= used where == is needed',
      why: 'Line {line} uses = (which stores a value) where a comparison is expected.',
      fix: 'Use == to compare: if score == 10:',
    },
    'syntax-comma': {
      title: 'A comma may be missing',
      why: 'Line {line} has two values next to each other without a comma between them.',
      fix: 'Put a comma between items: [1, 2, 3] or print("a", b)',
    },
    'syntax-print': {
      title: 'print needs brackets',
      why: 'Line {line} uses print without ( ). That was Python 2; Python 3 needs brackets.',
      fix: 'Write print("hello") instead of print "hello".',
    },
    'indent-expected': {
      title: 'The block after {stmt} is empty',
      why: 'The line after a : must be indented (pushed to the right) to show what belongs inside the block.',
      fix: 'Indent the next line with 4 spaces (press Tab). If the block is meant to be empty for now, write pass.',
    },
    'indent-unexpected': {
      title: 'This line is indented when it should not be',
      why: 'Line {line} starts further to the right than the lines around it, but no block was started above it.',
      fix: 'Line it up with the line above (remove the extra spaces at the start).',
    },
    'indent-unindent': {
      title: 'The indentation does not line up',
      why: 'Line {line} is pushed left to a position no block above it uses.',
      fix: 'Use exactly 4 spaces per level and line the code up with the block it belongs to.',
    },
    tabs: {
      title: 'Tabs and spaces are mixed',
      why: 'Some lines are indented with tabs and others with spaces, so Python cannot tell the levels apart.',
      fix: 'Re-indent the block using only spaces (Format Document does this).',
    },
    recursion: {
      title: 'A function calls itself forever',
      why: 'A function keeps calling itself and never reaches a case where it stops (the base case).',
      fix: 'Add a condition that returns without calling the function again, and make sure every call moves closer to it (e.g. n - 1).',
    },
    'file-not-found': {
      title: "The file '{file}' was not found",
      why: "Line {line} opens '{file}', but there is no such file where the program is looking.",
      fix: "Check the name and extension. Put the file in your project folder, or use its full path.",
    },
    eof: {
      title: 'input() got no input',
      why: 'The program asked for input (line {line}) but the input ended before anything was typed.',
      fix: 'Run the program again and type an answer in the output panel, then press Enter.',
    },
    interrupt: {
      title: 'The program was stopped',
      why: 'You stopped the program (Stop or Ctrl+C) while it was running.',
      fix: 'If it was stuck, check loops: a while loop needs something inside it that eventually makes its condition false.',
    },
    assert: {
      title: 'A check in the code failed',
      why: 'The assert on line {line} found that its condition was false.',
      fix: 'Print the values used in that assert to see why the condition is not true.',
    },
    overflow: {
      title: 'A number got too big',
      why: 'A calculation on line {line} produced a number larger than a decimal (float) can hold.',
      fix: 'Use smaller values, whole numbers (int has no limit), or check the formula.',
    },
    syntax: {
      title: 'Python cannot read line {line}',
      why: 'Something on line {line} (or just before it) is not written the way Python expects.',
      fix: 'Look for a missing bracket, quote, colon or comma near that line; the mistake is often on the line above.',
    },
    'generic-name': { title: 'A name is not known', why: 'Line {line} uses a name that was not created.', fix: 'Check spelling and make sure it gets a value first.' },
    'generic-type': { title: 'The wrong kind of value', why: 'Line {line} uses a value of a type that does not work there (text instead of a number, for example).', fix: 'Print the values and their type() to see what each one is, then convert with int(), float() or str().' },
    'generic-value': { title: 'The right kind of value, but a bad one', why: 'Line {line} gives a function a value it cannot use.', fix: 'Print the value just before that line to see what it is.' },
    'generic-index': { title: 'Position out of range', why: 'Line {line} asks for a position that does not exist.', fix: 'Print len() and the position used.' },
    'generic-key': { title: 'Key not found', why: 'Line {line} looks up a key that is not there.', fix: 'Print the keys() and use .get() for missing keys.' },
    'generic-attr': { title: 'Unknown attribute', why: 'Line {line} uses something after a dot that this value does not have.', fix: 'Check the spelling and print type(...) of the value.' },
    'generic-import': { title: 'The import did not work', why: 'Line {line} imports something that is not available.', fix: 'Check the name, and install the package if needed.' },
    'generic-os': { title: 'The computer refused a file action', why: 'Line {line} works with a file or folder that cannot be used (missing, or not allowed).', fix: 'Check the path and that the file is not open in another program.' },
    generic: { title: '{type}', why: 'The program stopped at line {line} with a {type}.', fix: 'Read the last line of the message below, and print the values used on that line.' },
  },
};
