# Cross-Language Immutability Patterns

Use these examples when the target language is not Python or TypeScript, or when reviewing language-agnostic design.

## Contents

- Universal Rules
- Java
- C#
- Go
- Rust
- Kotlin
- Review Prompts

## Universal Rules

- Copy inputs at trust boundaries before storing them.
- Prefer values, records, structs, tuples, and immutable collections for domain objects.
- Replace snapshots instead of patching objects already visible to readers.
- Keep mutation local to builders, parsers, deserializers, and tight loops.
- Make mutation obvious in names: `mutate`, `appendInPlace`, `reset`, or `set`.

## Java

Bad: store caller-owned mutable lists.

```java
public record Team(List<String> members) {
    public void add(String member) {
        members.add(member);
    }
}
```

Good: copy at the boundary and return a new record.

```java
public record Team(List<String> members) {
    public Team {
        members = List.copyOf(members);
    }

    public Team withMember(String member) {
        var next = new ArrayList<>(members);
        next.add(member);
        return new Team(next);
    }
}
```

## C#

Bad: expose a mutable list from a record.

```csharp
public record Team(List<string> Members)
{
    public void Add(string member) => Members.Add(member);
}
```

Good: copy inputs, expose read-only data, and copy on update.

```csharp
public sealed record Team
{
    public Team(IEnumerable<string> members)
    {
        Members = members.ToArray();
    }

    public IReadOnlyList<string> Members { get; }

    public Team WithMember(string member) =>
        new Team(Members.Concat(new[] { member }));
}
```

## Go

Bad: mutate caller-owned slices.

```go
type User struct {
    Roles []string
}

func AddRole(user *User, role string) {
    user.Roles = append(user.Roles, role)
}
```

Good: copy the slice and return a new value.

```go
type User struct {
    Roles []string
}

func WithRole(user User, role string) User {
    roles := append([]string(nil), user.Roles...)
    roles = append(roles, role)
    user.Roles = roles
    return user
}
```

For maps, always allocate a new map before changing keys.

## Rust

Rust prevents data races by default, but immutable update style can still make APIs easier to reason about.

Bad: require mutable access for a simple derived value.

```rust
fn add_role(user: &mut User, role: String) {
    user.roles.push(role);
}
```

Good: return a new value when callers should keep the old one.

```rust
fn with_role(user: &User, role: String) -> User {
    let mut roles = user.roles.clone();
    roles.push(role);
    User {
        roles,
        ..user.clone()
    }
}
```

Use `Arc` to share immutable data. Add `Mutex` or `RwLock` only when mutation is truly required.

## Kotlin

Bad: expose mutable collections.

```kotlin
data class Team(val members: MutableList<String>)

fun add(team: Team, member: String): Team {
    team.members.add(member)
    return team
}
```

Good: use read-only collection types and `copy`.

```kotlin
data class Team(val members: List<String> = emptyList())

fun add(team: Team, member: String): Team =
    team.copy(members = team.members + member)
```

## Review Prompts

- Can any caller still mutate this value through an alias?
- Does this API return a new value or mutate the input? Is that visible from the name?
- Are nested collections copied or made immutable at the boundary?
- Could concurrent readers observe a half-updated object?
- Is local mutation limited to unshared temporary data?
