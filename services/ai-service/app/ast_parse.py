"""Stage C — deterministic AST parse of a BRE rule expression (scope §5 Stage C).

Parse the expression like code. Builtins are whitelisted and ignored; the
remaining identifiers ARE the attributes to resolve — attributes derive from
the rule, never separately hallucinated.

Grammar (recursive descent):
    expr   := or
    or     := and (OR and)*
    and    := not (AND not)*
    not    := [NOT] cmp
    cmp    := arith ((<=|>=|==|!=|<|>) arith | IN set)?
    arith  := term ((+|-) term)*
    term   := factor ((*|/) factor)*
    factor := NUMBER | STRING | TRUE | FALSE | REF | NAME['(' args ')'] | '(' expr ')'
    set    := '{' [atom (',' atom)*] '}'
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

BUILTINS = {
    "days_since", "months_since", "years_since",
    "days_between", "hours_between", "months_between",
    "count", "exists", "max", "min", "sum", "abs",
}
_KEYWORDS = {"AND", "OR", "NOT", "IN", "TRUE", "FALSE"}

_TOKEN = re.compile(
    r"""
    (?P<WS>\s+)
  | (?P<REF>\[[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)?\])
  | (?P<NUMBER>\d+(?:\.\d+)?)
  | (?P<STRING>'[^']*'|"[^"]*")
  | (?P<NAME>[A-Za-z_]\w*)
  | (?P<OP><=|>=|==|!=|<|>|\+|-|\*|/|\(|\)|,|\{|\})
    """,
    re.VERBOSE,
)


@dataclass
class Node:
    """One node of the expression tree.

    The parser always built this shape implicitly through its call stack; before
    Step 14 it threw the structure away and kept only flat lists. Fingerprinting
    needs the tree, because "180 >= x" and "x <= 180" are the same duty and only
    a tree can be rewritten to say so.

    kind: or | and | not | cmp | in | arith | call | ref | num | str | bool
    """

    kind: str
    op: str | None = None
    value: float | int | str | bool | None = None
    children: list["Node"] = field(default_factory=list)

    def to_dict(self) -> dict:
        out: dict = {"kind": self.kind}
        if self.op is not None:
            out["op"] = self.op
        if self.value is not None:
            out["value"] = self.value
        if self.children:
            out["children"] = [c.to_dict() for c in self.children]
        return out


@dataclass
class AstResult:
    valid: bool
    functions: list[str] = field(default_factory=list)
    identifiers: list[str] = field(default_factory=list)
    literals: list[float | int | str] = field(default_factory=list)
    error: str | None = None
    tree: Node | None = None

    def to_dict(self) -> dict:
        return {
            "valid": self.valid,
            "functions": self.functions,
            "identifiers": self.identifiers,
            "literals": self.literals,
            "error": self.error,
            "tree": self.tree.to_dict() if self.tree else None,
        }


class _Parser:
    def __init__(self, tokens: list[tuple[str, str]]):
        self.tokens = tokens
        self.pos = 0
        self.functions: list[str] = []
        self.identifiers: list[str] = []
        self.literals: list[float | int | str] = []

    def peek(self) -> tuple[str, str] | None:
        return self.tokens[self.pos] if self.pos < len(self.tokens) else None

    def take(self) -> tuple[str, str]:
        tok = self.peek()
        if tok is None:
            raise SyntaxError("unexpected end of expression")
        self.pos += 1
        return tok

    def expect_op(self, op: str) -> None:
        tok = self.take()
        if tok[0] != "OP" or tok[1] != op:
            raise SyntaxError(f"expected '{op}', got '{tok[1]}'")

    def _kw(self, tok: tuple[str, str] | None) -> str | None:
        if tok and tok[0] == "NAME" and tok[1].upper() in _KEYWORDS:
            return tok[1].upper()
        return None

    def expr(self) -> Node:
        return self.and_or(level="OR")

    def and_or(self, level: str) -> Node:
        next_rule = (lambda: self.and_or("AND")) if level == "OR" else self.not_
        node = next_rule()
        operands = [node]
        while self._kw(self.peek()) == level:
            self.take()
            operands.append(next_rule())
        if len(operands) == 1:
            return node
        # Flattened, not nested: `a AND b AND c` becomes ONE n-ary node, so
        # sorting its operands later cannot depend on how the parse nested them.
        return Node(kind=level.lower(), children=operands)

    def not_(self) -> Node:
        if self._kw(self.peek()) == "NOT":
            self.take()
            return Node(kind="not", children=[self.cmp()])
        return self.cmp()

    def cmp(self) -> Node:
        left = self.arith()
        tok = self.peek()
        if tok and tok[0] == "OP" and tok[1] in ("<=", ">=", "==", "!=", "<", ">"):
            op = self.take()[1]
            return Node(kind="cmp", op=op, children=[left, self.arith()])
        if self._kw(tok) == "IN":
            self.take()
            return Node(kind="in", children=[left, self.set_()])
        return left

    def arith(self) -> Node:
        node = self.term()
        while (tok := self.peek()) and tok[0] == "OP" and tok[1] in "+-":
            op = self.take()[1]
            node = Node(kind="arith", op=op, children=[node, self.term()])
        return node

    def term(self) -> Node:
        node = self.factor()
        while (tok := self.peek()) and tok[0] == "OP" and tok[1] in "*/":
            op = self.take()[1]
            node = Node(kind="arith", op=op, children=[node, self.factor()])
        return node

    def factor(self) -> Node:
        tok = self.take()
        kind, value = tok
        if kind == "NUMBER":
            literal = float(value) if "." in value else int(value)
            self.literals.append(literal)
            return Node(kind="num", value=literal)
        if kind == "STRING":
            self.literals.append(value[1:-1])
            return Node(kind="str", value=value[1:-1])
        if kind == "REF":
            self.identifiers.append(value[1:-1])  # strip [ ]
            return Node(kind="ref", value=value[1:-1])
        if kind == "NAME":
            upper = value.upper()
            if upper in ("TRUE", "FALSE"):
                return Node(kind="bool", value=(upper == "TRUE"))
            if upper in _KEYWORDS:
                raise SyntaxError(f"unexpected keyword {value!r}")
            nxt = self.peek()
            if nxt and nxt[0] == "OP" and nxt[1] == "(":
                if value not in BUILTINS:
                    raise SyntaxError(f"unknown function {value!r}")
                self.functions.append(value)
                self.take()
                args: list[Node] = []
                if not (self.peek() and self.peek() == ("OP", ")")):
                    args.append(self.expr())
                    while self.peek() == ("OP", ","):
                        self.take()
                        args.append(self.expr())
                self.expect_op(")")
                return Node(kind="call", op=value, children=args)
            self.identifiers.append(value)
            return Node(kind="ref", value=value)
        if kind == "OP" and value == "(":
            inner = self.expr()
            self.expect_op(")")
            # Parentheses are not kept. Nesting IS the tree, so "(a) AND b" and
            # "a AND b" cannot produce different fingerprints.
            return inner
        raise SyntaxError(f"unexpected token {value!r}")

    def set_(self) -> Node:
        self.expect_op("{")
        members: list[Node] = []
        if self.peek() != ("OP", "}"):
            members.append(self.factor())
            while self.peek() == ("OP", ","):
                self.take()
                members.append(self.factor())
        self.expect_op("}")
        return Node(kind="set", children=members)


def parse_expression(expression: str) -> AstResult:
    tokens: list[tuple[str, str]] = []
    pos = 0
    while pos < len(expression):
        m = _TOKEN.match(expression, pos)
        if not m:
            return AstResult(valid=False, error=f"bad character at {pos}: '{expression[pos]}'")
        pos = m.end()
        kind = m.lastgroup
        if kind != "WS":
            tokens.append((kind, m.group()))

    if not tokens:
        return AstResult(valid=False, error="empty expression")

    parser = _Parser(tokens)
    tree: Node | None = None
    try:
        tree = parser.expr()
        if parser.peek() is not None:
            raise SyntaxError(f"trailing input from '{parser.peek()[1]}'")
    except SyntaxError as exc:
        return AstResult(
            valid=False, error=str(exc),
            functions=parser.functions, identifiers=parser.identifiers,
            literals=parser.literals,
        )

    # de-dup, preserve order
    seen: set[str] = set()
    idents = [i for i in parser.identifiers if not (i in seen or seen.add(i))]
    return AstResult(
        valid=True, functions=sorted(set(parser.functions)),
        identifiers=idents, literals=parser.literals, tree=tree,
    )
