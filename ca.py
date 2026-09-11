
import math


def add(x, y):

          return x + y


def subtract(x, y):

          return x - y


def multiply(x, y):

          return x * y


def divide(x, y):

          if y != 0:

              return x / y

          else:
            return "Error: Division by zero"

def power(x, y):

          return x ** y


def sqrt(x):

          if x >= 0:

              return math.sqrt(x)

          else:

              return "Error: Cannot calculate square root of a negative number"


def e_to_the_x(x):

          return math.exp(x)


def log_x(x):

          if x > 0:

              return math.log(x)

          else:

              return "Error: Logarithm undefined for non-positive numbers"


def scientific_calculator():

          print("Scientific Calculator")

          print("Select operation: 'add', 'subtract', 'multiply', 'divide', 'power', 'sqrt', 'e^x', 'logarithm'")

          selection = input("Enter your choice: ")


          if selection in ['add', 'subtract', 'multiply', 'divide', 'power', 'sqrt', 'e^x', 'logarithm']:

              if selection in ['add', 'subtract', 'multiply', 'divide', 'power']:

                  num1 = float(input("Enter first number: "))

                  num2 = float(input("Enter second number: "))

                  if selection == 'add':

                      print(add(num1, num2))

                  elif selection == 'subtract':

                      print(subtract(num1, num2))

                  elif selection == 'multiply':

                      print(multiply(num1, num2))

                  elif selection == 'divide':

                      print(divide(num1, num2))

                  elif selection == 'power':

                      num3 = float(input("Enter exponent: "))

                      print(power(num1, num3))

              elif selection in ['sqrt', 'e^x', 'logarithm']:

                  num = float(input("Enter a number: "))

                  if selection == 'sqrt':

                      print(sqrt(num))

                  elif selection == 'e^x':

                      print(e_to_the_x(num))

                  elif selection == 'logarithm':

                      print(log_x(num))

          else:

              print("Invalid input.")



          scientific_calculator()
