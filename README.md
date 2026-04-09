# AsciiAsm — Educational Assembler IDE

A [browser-based IDE](https://frostasm.github.io/ascii-asm/) for learning assembly language concepts through a simplified, human-readable virtual machine.


## What is AsciiAsm?

AsciiAsm (Education Assembler) is designed for teaching the fundamentals of low-level programming. It runs entirely in the browser and provides:

- A **code editor** with syntax highlighting, autocomplete, linting, and breakpoints
- A **virtual machine** that executes programs step-by-step
- A **debugger** with breakpoints, single-stepping, and live state inspection
- **Registers**, **flags**, and **memory** panels for real-time visualization

## How AsciiAsm Differs from Real Assemblers

AsciiAsm intentionally diverges from real assemblers like NASM in several key ways to make it more approachable for beginners.

### 1. Memory Is ASCII, Not Binary

In a real assembler (NASM), memory holds raw binary bytes. Numbers are stored in binary/hex notation and require understanding of two's complement, byte order, and bit widths:

```nasm
; NASM — x86-64
; Store the value 42 at address 0x1000
; Memory contains: 0x2A 0x00 0x00 0x00  (little-endian 32-bit)
mov dword [0x1000], 42
```

In AsciiAsm, **every memory cell holds a printable ASCII character**. Numbers are stored as their decimal digit characters, just like you'd write them on paper:

```nasm
; AsciiAsm
; Store the value 42 at address 0 (DWORD = 4 cells)
; Memory contains literally: '0' '0' '4' '2'  →  "0042"
MOV DWORD [0], 42
```

This means you can read what's in memory without any conversion — the memory panel shows human-readable characters directly.

### 2. Decimal-Only Numeric System

Real assemblers work in binary internally and support hex/octal/binary literals. Overflow wraps around using two's complement rules that require understanding binary arithmetic.

AsciiAsm uses a **purely decimal number system**. Each numeric type stores digits as ASCII characters:

| Type | Size | Range | Memory representation |
|------|------|-------|----------------------|
| `WORD` | 2 cells | −9 .. 99 | `"-4"`, `"04"`, `"99"` |
| `DWORD` | 4 cells | −999 .. 9999 | `"-042"`, `"0042"`, `"9999"` |
| `QWORD` | 8 cells | −9999999 .. 99999999 | `"00012345"`, `"-0012345"` |
| `CHAR` | 1 cell | ASCII 32–126 | `"A"`, `" "`, `"z"` |
| `TEXT` | variable | — | characters + `$` terminator |

Overflow is visible and explicit — it sets a flag and the result keeps the least-significant digits, exactly as you'd expect from decimal arithmetic on paper.

### 3. Strings Use `$` as Terminator

In C and most assemblers, strings are null-terminated — the string ends with a `\0` byte (ASCII 0), which is invisible and outside the printable range. In AsciiAsm, strings end with a `$` character (ASCII 36), which is a **printable character you can see directly in the memory panel**:

```
; AsciiAsm memory after: #data 0, TEXT "Hi!$"
; Cells: 'H' 'i' '!' '$'
;  Addr:  0    1   2   3
```

The `$` must be included explicitly in every string literal, making the terminator visible both in source code and in the memory visualization:

```nasm
#memory 16
#data 0, TEXT "Hello$"

_start:
    WRITELN TEXT [0]    ; outputs: Hello  (up to but not including '$')
    HALT
```

You can also read a string from the user and AsciiAsm automatically appends `$`:

```nasm
#memory 64

_start:
    READ    TEXT [0], "Your name: "   ; reads input, appends '$' automatically
    WRITE   "Hello, "
    WRITELN TEXT [0]
    HALT
```

This design makes the sentinel-value pattern concrete and visible — a lesson that's invisible in languages where `\0` is implicit.

### 4. Explicit Type Annotations on Every Memory Access

In NASM, the programmer tracks what type of data lives at an address mentally (or via naming conventions). AsciiAsm **requires stating the type on every memory access**, making data layout visible:

```nasm
; NASM — the type is implicit, reader must know the layout
mov eax, [rbp - 8]

; AsciiAsm — the type is always explicit
MOV AX, DWORD [0]
```

### 5. Four General-Purpose Registers

AsciiAsm provides exactly four registers (`AX`, `BX`, `CX`, `DX`), each with a **dynamic type** (integer or CHAR). There are no segment registers, stack pointer, or instruction pointer exposed to the programmer. This removes a large class of complexity while preserving the core concept of register-based computation.

### 6. No Stack — No Subroutines (v0.4)

The current version has no `PUSH`/`POP`/`CALL`/`RET`. Programs are flat sequences of instructions with labels for jumps. This keeps the focus on basic control flow and memory before layering on the call stack concept.

---

## Quick Start Examples

### Hello, World

```nasm
#memory 16
#data 0, TEXT "Hello, World!$"

_start:
    WRITELN TEXT [0]
    HALT
```

**Output:**
```
Hello, World!
```

---

### Reading and Printing a Number

```nasm
#memory 8
#data 0, DWORD 0

_start:
    READ  DWORD [0], "Enter a number: "
    WRITE "You entered: "
    WRITELN DWORD [0]
    HALT
```

**Output:**
```
You entered: 42
```

---

### Visible Memory Layout

This example shows AsciiAsm's human-readable memory directly. After running, the Memory panel shows ASCII characters — no hex dump needed:

```nasm
#memory 16
#data 0, WORD 7,   #4488ff   ; blue  — cells 0..1  contain "07"
#data 2, DWORD 42, #44bb77   ; green — cells 2..5  contain "0042"
#data 6, CHAR 'A', #ffaa00   ; amber — cell  6     contains "A"

_start:
    MOV AX, WORD  [0]     ; AX = 7
    MOV BX, DWORD [2]     ; BX = 42
    ADD AX, BX            ; AX = 49
    MOV WORD [0], AX
    WRITELN WORD [0]       ; prints: 49
    HALT
```

---

### Comparison with NASM: Sum of Two Numbers

**NASM (x86-64 Linux):**
```nasm
section .bss
    a resq 1
    b resq 1

section .text
global _start
_start:
    ; reading integers from stdin requires syscalls + atoi — omitted for brevity
    mov rax, [a]
    add rax, [b]
    ; printing result requires syscalls + itoa — omitted for brevity
    mov rax, 60
    syscall
```

**AsciiAsm:**
```nasm
#memory 16
#data 0, DWORD 0
#data 4, DWORD 0

_start:
    READ  DWORD [0], "First number: "
    READ  DWORD [4], "Second number: "
    MOV   AX, DWORD [0]
    ADD   AX, DWORD [4]
    WRITE "Sum: "
    WRITELN AX
    HALT
```

AsciiAsm handles I/O directly as language instructions, eliminating the syscall layer that overwhelms beginners.

---

### Character Arithmetic

Because memory cells are ASCII, CHAR arithmetic shifts a character along the ASCII table — which makes operations like case conversion intuitive:

```nasm
#memory 4
#data 0, CHAR 'a'

_start:
    WRITE   CHAR [0]      ; outputs: a
    SUB     CHAR [0], 32  ; 'a' (97) - 32 = 'A' (65)
    WRITELN CHAR [0]      ; outputs: A
    HALT
```

**Output:**
```
aA
```

In NASM, the same idea works numerically but requires knowing that `'a' - 'A' == 32` and that you're operating on a byte register — concepts AsciiAsm makes visually obvious through its ASCII memory model.

---

## Running Locally

```bash
npm install
npm run dev       # start dev server
npm run build     # production build
npm run test      # run unit tests
```

## Tech Stack

| | |
|-|-|
| **TypeScript** | All source code |
| **Vue 3** | UI (Composition API) |
| **Vite** | Build tool |
| **Vitest** | Unit tests |
| **CodeMirror 6** | Code editor |
