# Python Scientific Calculator

A command-line scientific calculator written in Python. It performs basic arithmetic, exponentiation, square roots, exponentials and natural logarithms, and it checks for common math errors such as division by zero. It uses only Python's standard library, so there is nothing to install.

## Features

| Operation (type exactly) | What it does | Inputs |
|---|---|---|
| `add` | x + y | Two numbers |
| `subtract` | x − y | Two numbers |
| `multiply` | x × y | Two numbers |
| `divide` | x ÷ y | Two numbers |
| `power` | x raised to an exponent | First number, second number (unused, see Known Limitations), exponent |
| `sqrt` | Square root of x | One number |
| `e^x` | e raised to the power x | One number |
| `logarithm` | Natural logarithm (base e) of x | One number |

All inputs are read as decimal numbers (`float`), so results are shown as decimals, for example `5.0`.

## Requirements

- Python 3. Tested on Python 3.12.
- No external libraries. The code uses only the built-in `math` module.

## Installation

```bash
git clone https://github.com/ananye532/CAP-776.git
cd CAP-776
```

## Usage

Start the calculator:

```bash
python -c "import ca; ca.scientific_calculator()"
```

On some systems the command is `python3` instead of `python`.

Running `python ca.py` directly does not start the calculator yet. See Known Limitations.

### Example session

```
Scientific Calculator
Select operation: 'add', 'subtract', 'multiply', 'divide', 'power', 'sqrt', 'e^x', 'logarithm'
Enter your choice: add
Enter first number: 2
Enter second number: 3
5.0
Scientific Calculator
Select operation: 'add', 'subtract', 'multiply', 'divide', 'power', 'sqrt', 'e^x', 'logarithm'
Enter your choice: divide
Enter first number: 1
Enter second number: 0
Error: Division by zero
```

After each result the menu appears again. To quit, press `Ctrl + C`.

## Error Handling

| Situation | Output |
|---|---|
| Division by zero | `Error: Division by zero` |
| Square root of a negative number | `Error: Cannot calculate square root of a negative number` |
| Logarithm of zero or a negative number | `Error: Logarithm undefined for non-positive numbers` |
| Unrecognized operation name | `Invalid input.` |

## Project Structure

```
CAP-776/
├── ca.py                    # Calculator: operation functions and the interactive menu
└── sickness_classifier.py   # Separate program, not covered by this README
```

Functions in `ca.py`:

- `add`, `subtract`, `multiply`, `divide`, `power`: two-number operations
- `sqrt`, `e_to_the_x`, `log_x`: one-number operations
- `scientific_calculator`: shows the menu, reads input, calls the matching function, and prints the result

## Known Limitations

- **No entry point.** The call that starts the calculator is inside the `scientific_calculator` function. Running `python ca.py` therefore defines the functions and exits without doing anything.
- **Unused input in `power`.** `power` asks for a second number that is never used. The exponent is taken from the third prompt.
- **Non-numeric input crashes the program.** Entering text such as `abc` when a number is expected stops the program with a `ValueError`.
- **No exit command.** The program repeats by calling itself (recursion), so the only way out is `Ctrl + C`. After roughly 1,000 calculations in one session, Python's default recursion limit will stop it with a `RecursionError`.
- **Case-sensitive operation names.** `Add` or `ADD` gives `Invalid input.`
- **Errors are returned as text.** Math errors come back as strings rather than being raised as exceptions, so other code that imports these functions cannot easily tell a result from an error.

## Author

Ananye Dwivedi — [github.com/ananye532](https://github.com/ananye532)
