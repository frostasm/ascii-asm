# AsciiAsm — Education Assembler Language Specification

**Version:** 0.1.0  
**Purpose:** An educational low-level language with a minimal instruction set.  
**Syntax:** Intel-style (destination operand on the left), inspired by NASM.  

---

## 1. Architectural AsciiAsm Language Overview

### 1.1 General-Purpose Registers

| Register | Conventional Purpose       |
|----------|----------------------------|
| `AX`     | Accumulator, results       |
| `BX`     | Addresses, pointers        |
| `CX`     | Counters, loops            |
| `DX`     | Auxiliary operand          |

> Conventional purpose is only a convention. Any register can be used for any purpose.

Each register has a **dynamic type** — **CHAR** or **integer** — determined
by the last write operation:

- `MOV reg, imm` or `MOV reg, WORD/DWORD/QWORD [addr]` → register type becomes **integer**.
- `MOV reg, CHAR 'c'` or `MOV reg, CHAR [addr]` → register type becomes **CHAR**.
- `MOV reg, reg2` → copies both value and type.

Mixing CHAR and integer types is forbidden in all operations, **except** `ADD`/`SUB`
(CHAR ± integer = CHAR). Attempting to perform a forbidden cross-type operation
results in a runtime error: `Runtime Error: Type Mismatch`.


### 1.2 Service Registers (not accessible from program code)

| Register | Purpose                                                                    |
|----------|----------------------------------------------------------------------------|
| `SLP`    | Source Line Pointer — index of the current instruction in source code (line) |
| `FLAGS`  | Status flags: ZF, SF, OF                                                   |

### 1.3 Flags (FLAGS)

| Flag | Name          | Set when...                                  |
|------|---------------|----------------------------------------------|
| `ZF` | Zero Flag     | Operation result = 0                         |
| `SF` | Sign Flag     | Mathematical result is negative (not truncated after overflow) |
| `OF` | Overflow Flag | Result exceeds the type's range              |

Flags are updated by: `READ`, `MOV`, `ADD`, `SUB`, `CMP`. All other instructions do not modify flags.

---

## 2. Memory

### 2.1 Directive #memory

```
#memory memory_size[, 'init_char_value']
```

Specifies the number of memory cells (integer > 0) and an ASCII value for initializing all memory (optional).
If absent — default size: **100** and memory is uninitialized.
Must be the first line of the program if present.
Accessing memory beyond its bounds causes the program to terminate with an error.


### 2.2 Directive #on_overflow

This pragma allows switching the processor's behavior when an arithmetic overflow occurs.

`#on_overflow flag` (default mode):
On overflow, only the OF flag is set in the FLAGS register. The program continues executing the next instruction. This allows the programmer to decide what to do (e.g., use `JO label`).

`#on_overflow halt`
On any operation that causes OF = 1 (including MOV, READ), the interpreter immediately halts execution with an error `Runtime Error: Type Overflow`. This is useful for beginners so they can immediately see logic errors.

### 2.3 Memory Model

Memory is a linear array of ASCII cells, indexed from 0.
Each cell stores one character (ASCII code 32–126 — printable characters only).
The minimum addressable unit is one cell.

> **Warning:** memory is **not initialized** by default — cells contain random ASCII characters.
> The program must write values before first read, or use `#data` for explicit initialization.

### 2.4 Data Types

AsciiAsm has five types. All numeric types are signed.

| Type    | Cells   | Format in memory                    | Range                   |
|---------|---------|-------------------------------------|-------------------------|
| `CHAR`  | 1       | raw ASCII character                 | codes 32–126 (printable)|
| `WORD`  | 2       | [sign] + 1-2 digits                 | -9..99                  |
| `DWORD` | 4       | [sign] + 3-4 digits                 | -999..9999              |
| `QWORD` | 8       | [sign] + 7-8 digits                 | -9999999..99999999      |
| `TEXT`  | variable| ASCII characters until terminator `$`| —                      |

#### Number Format in Memory (WORD / DWORD / QWORD)

First cell — sign `'-'` for negatives; for positives — the most significant digit or a leading zero.
Remaining cells — digits with leading zeros padded to full width.

Examples as ASCII strings:

```
WORD   -4  →  "-4"
WORD    4  →  "04"
WORD    0  →  "00"

DWORD  -42   →  "-042"
DWORD   42   →  "0042"
DWORD  -999  →  "-999" # minimum value for DWORD type
DWORD    0   →  "0000"
DWORD   999  →  "0999"
DWORD  9999  →  "9999" # maximum value for DWORD type

QWORD  -12345  →  "-0012345"
QWORD   12345  →  "00012345"
```

#### CHAR Format in Memory

One cell, stores the character directly as an ASCII character.
Arithmetic on CHAR shifts the character's position in the ASCII table.

```
CHAR 'A'  →  "A"    (ASCII 65)
CHAR 'z'  →  "z"    (ASCII 122)
CHAR ' '  →  " "    (ASCII 32)
```

Valid values: ASCII 32–126 (printable characters only).
Going out of range during operations — type overflow with clamping to the nearest valid value.

#### TEXT Format in Memory

A sequence of ASCII characters terminated by the `$` terminator character.
Size is not fixed — determined by the position of `$`.

```
"Hello"  →  "Hello$"   (6 cells)
""       →  "$"         (1 cell)
```

### 2.5 Directive #data — Memory Initialization

`#data` directives are placed after `#memory` and before the first instruction.
They write values at the specified absolute address.

```
#data address, TYPE value[, #RRGGBB]
```

The optional third parameter `#RRGGBB` is a CSS hex color literal (six lowercase or uppercase hex digits
preceded by `#`). When present, all memory cells written by this directive are highlighted with that
background color in the IDE's **Memory** visualization panel, which helps users visually distinguish
different data segments at a glance.

Syntax for each type:

```
#data 0,  WORD -4
#data 2,  DWORD 42,       #4488ff   ; integer — blue tint
#data 6,  QWORD 9999999
#data 14, CHAR 'A',        #ffaa00   ; character — amber tint
#data 15, TEXT "Hello$",   #44bb77   ; text segment — green tint
```

Rules:
- Address — a non-negative decimal integer. The address must not exceed the memory bounds, otherwise a runtime error occurs.
- Directives are executed sequentially; a later one overwrites an earlier one.
- Address + size must not exceed `#memory`.
- For `TEXT`: the `$` character is mandatory in the literal.
- For `CHAR`: literal in single quotes (`'A'`).
- Color — exactly six hexadecimal digits preceded by `#` (e.g. `#ff0000`). Case-insensitive.
  - If multiple directives cover the same memory cell, the last directive's color wins.
  - The color has no effect at runtime; it is a visualization aid only.

---

## 3. Syntax

### 3.1 General Rules

- Comment — from `;` to end of line.
- Mnemonics, registers, types — case-insensitive.
- Label identifiers: `[a-zA-Z_][a-zA-Z0-9_]*`
- Numeric literals: decimal with or without sign (`42`, `-7`).
- Character literals: single quotes (`'A'`, `' '`).

### 3.2 Program Structure

```
[#memory N]
[#data address, TYPE value[, #RRGGBB]]
...

_start:
    instructions
    HALT

[other labels and instructions]
```

The `_start:` label is mandatory. Labels in code: `identifier:` at the beginning of a line.
Labels are used only in branch instructions (`JMP`, `JE`, ...).


### 3.3 Addressing

| Form           | Meaning                                   |
|----------------|-------------------------------------------|
| `reg`          | register value (type is dynamic)          |
| `imm`          | numeric constant (type — integer)         |
| `CHAR 'c'`     | character constant (type — CHAR)          |
| `TYPE [imm]`   | memory at absolute address of type TYPE   |
| `TYPE [reg]`   | memory at register address of type TYPE   |

`TYPE` is mandatory for every memory access through `[...]`.
`CHAR 'c'` can be used as an operand in `MOV reg, CHAR 'c'`, `CMP reg, CHAR 'c'` and `MOV CHAR [addr], 'c'`.

---

## 4. Instruction Set

### 4.1 MOV — Data Movement (copying data)

```nasm
MOV dst, src                ; general command format
MOV reg, imm                ; reg ← number (register type → integer)
MOV reg, CHAR 'c'           ; reg ← character (register type → CHAR)
MOV reg, reg2               ; reg ← reg2 (value and type are copied)
MOV reg, TYPE [addr]        ; reg ← value from memory (register type → according to TYPE)
MOV TYPE [addr], reg        ; memory ← reg (register type must match TYPE)
MOV TYPE [addr], imm        ; memory ← constant (TYPE: WORD/DWORD/QWORD, not CHAR)
MOV CHAR [addr], 'c'        ; memory CHAR ← character literal
```

`[addr]` — `[imm]` or `[reg]`.

**Type rules:**
- `MOV WORD/DWORD/QWORD [addr], reg` — reg **must** contain an integer, otherwise `Runtime Error: Type Mismatch`.
- `MOV CHAR [addr], reg` — reg **must** contain CHAR, otherwise `Runtime Error: Type Mismatch`.
- `MOV CHAR [addr], imm` — **forbidden** (`Runtime Error: Type Mismatch`). Use `MOV CHAR [addr], 'c'`.

MOV updates flags if data does not fit in dst and digits were truncated.


### 4.2 Arithmetic

The result is stored in the first operand. Flags `ZF`, `SF`, `OF` are updated.
On overflow, `SF` is based on the mathematical result, not the truncated one.

```nasm
ADD dst, src
SUB dst, src
```

Allowed combinations:

| `dst`          | `src`          | Note                                                                 |
|----------------|----------------|----------------------------------------------------------------------|
| `reg(integer)` | `reg(integer)` | integer ± integer = integer                                          |
| `reg(integer)` | `imm`          | integer ± integer = integer                                          |
| `reg(CHAR)`    | `imm`          | CHAR ± integer = CHAR (ASCII position shift)                         |
| `reg(CHAR)`    | `reg(integer)` | CHAR ± integer = CHAR (ASCII position shift)                         |
| `reg`          | `TYPE [addr]`  | TYPE: WORD/DWORD/QWORD; reg must be an integer                      |
| `TYPE [addr]`  | `reg(integer)` | read → compute → write back; TYPE: WORD/DWORD/QWORD/CHAR            |
| `TYPE [addr]`  | `imm`          | read → compute → write back; TYPE: WORD/DWORD/QWORD/CHAR            |

**Forbidden combinations** (runtime error `Runtime Error: Type Mismatch`):
- CHAR + CHAR, CHAR − CHAR (any combination where both operands are CHAR)
- integer + CHAR, integer − CHAR (src is CHAR)
- `reg(CHAR)` + `TYPE [addr]` (CHAR register with numeric memory)

**CHAR arithmetic** — the only allowed cross-type: CHAR ± integer.
This allows shifting a character along the ASCII table (e.g., changing letter case).
Result outside 32–126 — overflow (OF=1), result is clamped to the nearest range boundary (32 or 126).

For WORD/DWORD/QWORD: overflow → OF=1, result is written as-is using the least significant digits.

TEXT does not support arithmetic.

### 4.3 CMP — Comparison

Computes `first − second`, updates `ZF`, `SF`, `OF`. Does not store the value.
On overflow, `SF` is based on the mathematical result, not the truncated one.

Comparison is allowed only within the same type: CHAR with CHAR, integer with integer.
Attempting to compare CHAR with integer → `Runtime Error: Type Mismatch`.

```nasm
CMP reg,          reg2          ; both registers must match by type (CHAR↔CHAR or integer↔integer)
CMP reg,          imm           ; reg must be an integer
CMP reg,          CHAR 'c'      ; reg must be CHAR
CMP reg,          TYPE [addr]   ; reg type must match TYPE (CHAR↔CHAR or integer↔integer)
CMP TYPE [addr],  reg           ; reg type must match TYPE
CMP TYPE [addr],  imm           ; TYPE: WORD/DWORD/QWORD (not CHAR)
CMP CHAR [addr],  'c'           ; CHAR ↔ CHAR
```

TYPE: WORD / DWORD / QWORD / CHAR. TEXT is not supported.


### 4.4 Branches

All numeric types are signed — only signed branch conditions.

```nasm
JMP label   ; unconditional
JO  label   ; OF = 1  jump if overflow occurred
JNO label   ; OF = 0  jump if no overflow
JE  label   ; ZF=1          equal (==)
JNE label   ; ZF=0          not equal (!=)
JL  label   ; SF=1, ZF=0    less than (<)
JLE label   ; SF=1 or ZF=1  less than or equal (<=)
JG  label   ; SF=0, ZF=0    greater than (>)
JGE label   ; SF=0 or ZF=1  greater than or equal (>=)
```

### 4.5 READ and WRITE — Input and Output

Full syntax (memory operand):

```nasm
READ    TYPE [addr]         ; read from stdin → memory
WRITE   TYPE [addr]         ; output from memory → stdout
WRITELN [TYPE [addr]]       ; output from memory → stdout and output a newline character at the end.
```

WRITELN — can be used without parameters, in which case it simply outputs a newline character.

**Shorthand WRITE/WRITELN forms (registers and constants):**

```nasm
WRITE   reg                 ; output register value (integer as number, CHAR as character)
WRITE   imm                 ; output integer constant
WRITE   'c'                 ; output character literal
WRITE   "text"              ; output string literal directly (trailing '$' stripped if present)

WRITELN reg
WRITELN imm
WRITELN 'c'
WRITELN "text"
```

Examples:

```nasm
MOV  AX, 42
WRITE AX          ; outputs: 42

MOV  BX, CHAR 'Z'
WRITE BX          ; outputs: Z

WRITE 10          ; outputs: 10
WRITE 'C'         ; outputs: C
WRITE "Hello"     ; outputs: Hello
WRITELN "Done"    ; outputs: Done followed by newline
```

Behavior by type (memory operand):

| Type    | READ                                         | WRITE                                     |
|---------|----------------------------------------------|-------------------------------------------|
| `WORD`  | read number → store in WORD format           | output number without leading zeros and '+'|
| `DWORD` | read number → store in DWORD format          | output number without leading zeros and '+'|
| `QWORD` | read number → store in QWORD format          | output number without leading zeros and '+'|
| `CHAR`  | read one character → store as CHAR           | output one character directly              |
| `TEXT`  | read string → store + `$`                    | output characters until `$` (exclusive), no length validation except out-of-bounds #memory check |

Additional parameters:
```nasm
READ TYPE  [addr],        "prompt"      ; display prompt before asking for input
READ TEXT  [addr],        "prompt"      ; TEXT input with prompt, no length limit
READ TEXT  [addr], imm                  ; read a string, max (imm - 1) characters, append `$` at the end
READ TEXT  [addr], imm,  "prompt"      ; TEXT input with max length and prompt
```

The optional `"prompt"` string literal is passed to the host environment and displayed to the user before input is requested (e.g. shown in a browser prompt dialog). It can be appended to any READ form as the last parameter.

Truncation on `READ` when a number does not fit in the type: preserve the sign, keep the least significant digits that fit in the given type. On truncation, the overflow flag OF is set.

### 4.6 HALT

`HALT` — stops program execution and must be explicitly specified to terminate the program.

---

## 5. Example Programs

### 5.1 Sum of Two Numbers

```nasm
#memory 16
#data 0, DWORD 0
#data 4, DWORD 0

_start:
    READ  DWORD [0]
    READ  DWORD [4]
    MOV   AX, DWORD [0]
    ADD   AX, DWORD [4]
    MOV   DWORD [0], AX
    WRITELN DWORD [0]
    HALT
```

### 5.2 Maximum of Two Numbers

```nasm
#memory 16
#data 0, DWORD 0
#data 4, DWORD 0

_start:
    READ DWORD [0]
    READ DWORD [4]
    MOV  AX, DWORD [0]
    CMP  AX, DWORD [4]
    JGE  show_first
    WRITELN DWORD [4]
    JMP  done
show_first:
    WRITELN DWORD [0]
done:
    HALT
```

### 5.3 Loop: Sum from 1 to N

```nasm
#memory 32
#data 0, DWORD 0    ; n
#data 4, DWORD 0    ; i
#data 8, QWORD 0    ; total

_start:
    READ  DWORD [0]        ; n
    MOV   DWORD [4], 1     ; i = 1
loop:
    MOV   AX, DWORD [4]
    CMP   AX, DWORD [0]
    JG    done
    ADD   QWORD [8], AX    ; total += i
    ADD   DWORD [4], 1     ; i++
    JMP   loop
done:
    WRITELN QWORD [8]
    HALT
```

### 5.4 String Output

```nasm
#memory 32
#data 0, TEXT "Hello, World!$"

_start:
    WRITELN TEXT [0]
    HALT
```

### 5.5 Working with CHAR

```nasm
#memory 8, '-'
#data 0, CHAR 'A'

_start:
    WRITE CHAR [0]         ; outputs: A
    ADD   CHAR [0], 1      ; 'A' + 1 = 'B'
    WRITELN CHAR [0]       ; outputs: B
    HALT
```

---

## 6. Instruction Summary Table

| Instruction            | Description                             | FLAGS |
|------------------------|-----------------------------------------|:-----:|
| `MOV dst, src`         | Move (types must match)                 | Yes   |
| `ADD dst, src`         | Addition (CHAR±integer allowed)         | Yes   |
| `SUB dst, src`         | Subtraction (CHAR±integer allowed)      | Yes   |
| `CMP a, b`             | Comparison (types must match)           | Yes   |
| `JMP label`            | Unconditional jump                      | No    |
| `JE  / JNE label`      | Equal / not equal                       | No    |
| `JL  / JLE label`      | Less than / less than or equal          | No    |
| `JG  / JGE label`      | Greater than / greater than or equal    | No    |
| `JO  / JNO label`      | Overflow / no overflow                  | No    |
| `READ  TYPE [addr]`          | Read from stdin into memory             | Yes   |
| `READ  TYPE [addr], "msg"`   | Read from stdin with prompt message     | Yes   |
| `READ  TEXT [addr], n`       | Read string (max n-1 characters)        | Yes   |
| `READ  TEXT [addr], n, "msg"`| Read string with max length and prompt  | Yes   |
| `WRITE TYPE [addr]`    | Output from memory to stdout            | No    |
| `WRITE reg`            | Output register value to stdout         | No    |
| `WRITE imm`            | Output integer constant to stdout       | No    |
| `WRITE 'c'`            | Output character literal to stdout      | No    |
| `WRITE "text"`         | Output string literal to stdout         | No    |
| `WRITELN TYPE [addr]`  | Output from memory to stdout + "\n"     | No    |
| `WRITELN reg/imm/'c'/"text"` | Output value to stdout + "\n"     | No    |
| `WRITELN`              | Output newline only                     | No    |
| `HALT`                 | Stop program                            | No    |

---

## 7. Open Questions for Future Versions

### Variables

At the current stage AsciiAsm does not have named variables. Data is addressed
numerically (`[0]`, `[4]`, `[BX]`), and initialization is done via `#data`.

In future versions, named variables are planned:

```nasm
; Possible future syntax:
x   DWORD 0
msg TEXT  "Hello$"
```

A named variable would automatically reserve an address and allow
referring to it by name: `MOV AX, DWORD [x]`.

### Other Planned Features

- **Type conversion** — `CAST` instruction for explicit integer↔CHAR conversion (via ASCII code).
- **Stack and subroutines** — `PUSH`, `POP`, `CALL`, `RET`.
- **Multiplication / division** — `MUL`, `DIV`.
- **Offset addressing** — `[BX + 4]` for working with arrays.
- **Macros** — defining custom abbreviations.
