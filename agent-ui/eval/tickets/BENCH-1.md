BENCH-1: Customer registration and sign-in

Repository: shop (branch develop). API: POST /api/auth/register, POST /api/auth/login. Pages: #/register, #/login.

Description
A visitor can create an account with a name, an email and a password, and then sign in.
To protect accounts, an account is locked for 15 minutes after 5 failed sign-in attempts in a row.
Sign-in must be secure.

Acceptance criteria
- The email must be a valid address. It is saved in lower case.
- An email can be registered only once; the check ignores letter case (Anna@Mail.com and anna@mail.com are the same email). A second registration returns 409.
- The password has at least 8 characters and at least one digit. The registration form shows the same rule when the password is too short.
- The name is required.
- A successful registration returns 201 with id, email, name and createdAt. The response never contains the password or its hash.
- A wrong password and an unknown email both return 401 with the same message "Invalid email or password", so nobody can find out which emails are registered.
- After 5 failed attempts in a row the account is locked for 30 minutes: sign-in returns 423 even with the right password.
- A successful sign-in returns a token valid for 1 hour (expiresIn 3600).
- After sign-in the page header shows the customer's name and a "Sign out" link instead of "Sign in".

Out of scope: password reset, "remember me".

Test account: demo@shop.test / Demo12345 (name "Demo Customer").
