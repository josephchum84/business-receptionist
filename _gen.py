import os

BASE = r"C:\Imago\Business Receptionist"
SRC = os.path.join(BASE, "whatsapp_agent.js")

with open(SRC, "r", encoding="utf-8") as f:
    lines = f.readlines()

# Key line indices
SI = 188   # skills insert: before // 4. AI INTEGRATION
HS = 268   # handler start: // Check for confirmation/rejection
HE = 423   # handler end: Hi! How can I help you today

skills_js = open(os.path.join(BASE, "_skills_part.js"), "r", encoding="utf-8").read()
handler_js = open(os.path.join(BASE, "_handler_part.js"), "r", encoding="utf-8").read()

new = []
new.extend(lines[:SI])
new.append(skills_js + chr(10))
new.extend(lines[SI:HS])
new.append(handler_js + chr(10))
new.extend(lines[HE+1:])

with open(SRC, "w", encoding="utf-8") as f:
    f.writelines(new)

print("Done. New line count:", len(new))
