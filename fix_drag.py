with open(r"C:\Users\Memoona\Downloads\SAJIL TARQ\MCP\index.html") as f:
    content = f.read()
content = content.replace('id="col-review" class="kanban-list" ondragover=', 'id="col-review" class="kanban-list" ondragenter="handleDragEnter(event)" ondragover=')
content = content.replace('id="col-completed" class="kanban-list" ondragover=', 'id="col-completed" class="kanban-list" ondragenter="handleDragEnter(event)" ondragover=')
with open(r"C:\Users\Memoona\Downloads\SAJIL TARQ\MCP\index.html", "w") as f:
    f.write(content)
print("Fixed review/completed dragenter")
