/**
 * THETA172 — Code Examples
 */

export const EXAMPLES = [
  {
    name: 'Hello World + Input',
    desc: 'Basic input/output with a greeting',
    code: `name = input("Enter your name: ")
age = input("Enter your age: ")
print(f"Hello, {name}! You are {age} years old.")
`,
  },
  {
    name: 'Fibonacci Sequence',
    desc: 'Generate Fibonacci numbers with user-defined count',
    code: `def fibonacci(n):
    a, b = 0, 1
    for i in range(n):
        print(f"  F({i}) = {a}")
        a, b = b, a + b

n = int(input("How many terms? "))
print(f"\\nFibonacci sequence ({n} terms):")
fibonacci(n)
`,
  },
  {
    name: 'Calculator',
    desc: 'Simple arithmetic calculator with two numbers',
    code: `print("THETA172 Calculator")
print("-" * 20)

a = float(input("Enter first number: "))
b = float(input("Enter second number: "))
op = input("Operation (+, -, *, /): ")

if op == '+':
    result = a + b
elif op == '-':
    result = a - b
elif op == '*':
    result = a * b
elif op == '/':
    if b == 0:
        print("Error: Division by zero!")
    else:
        result = a / b
else:
    print("Unknown operation")
    result = None

if result is not None:
    print(f"\\nResult: {a} {op} {b} = {result}")
`,
  },
  {
    name: 'Sorting Algorithms',
    desc: 'Bubble sort and built-in sort comparison',
    code: `import time
import random

def bubble_sort(arr):
    n = len(arr)
    arr = arr.copy()
    for i in range(n):
        for j in range(n - i - 1):
            if arr[j] > arr[j + 1]:
                arr[j], arr[j + 1] = arr[j + 1], arr[j]
    return arr

n = int(input("Array size (e.g. 100): "))
data = [random.randint(1, 1000) for _ in range(n)]

print(f"\\nSorting {n} random numbers...")
print(f"First 5 unsorted: {data[:5]}")

t0 = time.time()
sorted_bubble = bubble_sort(data)
t1 = time.time()

t2 = time.time()
sorted_builtin = sorted(data)
t3 = time.time()

print(f"\\nBubble sort:  {(t1-t0)*1000:.2f}ms")
print(f"Built-in sort: {(t3-t2)*1000:.2f}ms")
print(f"\\nFirst 5 sorted: {sorted_bubble[:5]}")
print(f"Results match: {sorted_bubble == sorted_builtin}")
`,
  },
  {
    name: 'Guess the Number',
    desc: 'Classic number guessing game with feedback',
    code: `import random

secret = random.randint(1, 100)
attempts = 0
max_attempts = 7

print("THETA172 — Guess the Number")
print(f"I'm thinking of a number between 1 and 100.")
print(f"You have {max_attempts} attempts.\\n")

while attempts < max_attempts:
    attempts += 1
    remaining = max_attempts - attempts
    
    try:
        guess = int(input(f"Attempt {attempts}/{max_attempts}: "))
    except ValueError:
        print("Please enter a valid number.")
        attempts -= 1
        continue
    
    if guess == secret:
        print(f"\\nCorrect! You got it in {attempts} attempt(s)!")
        break
    elif guess < secret:
        print(f"Too low! {'(' + str(remaining) + ' left)' if remaining > 0 else ''}")
    else:
        print(f"Too high! {'(' + str(remaining) + ' left)' if remaining > 0 else ''}")
else:
    print(f"\\nGame over. The number was {secret}.")
`,
  },
  {
    name: 'Data Analysis',
    desc: 'Statistics on a list of numbers you enter',
    code: `numbers = []
print("Enter numbers one by one. Type 'done' when finished.\\n")

while True:
    val = input("Enter number: ")
    if val.lower() == 'done':
        break
    try:
        numbers.append(float(val))
    except ValueError:
        print("Invalid number, try again.")

if not numbers:
    print("No numbers entered.")
else:
    n = len(numbers)
    total = sum(numbers)
    mean = total / n
    minimum = min(numbers)
    maximum = max(numbers)
    
    sorted_nums = sorted(numbers)
    if n % 2 == 0:
        median = (sorted_nums[n//2 - 1] + sorted_nums[n//2]) / 2
    else:
        median = sorted_nums[n//2]
    
    variance = sum((x - mean) ** 2 for x in numbers) / n
    std_dev = variance ** 0.5
    
    print(f"\\n--- Statistics ({n} values) ---")
    print(f"Sum:      {total:.4f}")
    print(f"Mean:     {mean:.4f}")
    print(f"Median:   {median:.4f}")
    print(f"Min:      {minimum:.4f}")
    print(f"Max:      {maximum:.4f}")
    print(f"Std Dev:  {std_dev:.4f}")
`,
  },
];
