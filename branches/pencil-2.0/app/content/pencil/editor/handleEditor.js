function HandleEditor() {
    this.svgElement = null;
    this.canvas = null;
}
HandleEditor.ANCHOR_SIZE = 6;
HandleEditor.configDoc = Dom.loadSystemXml("chrome://pencil/content/editor/handleEditor.config.xml");
HandleEditor.prototype.install = function (canvas) {
    this.canvas = canvas;
    this.canvas.onScreenEditors.push(this);
    this.svgElement = canvas.ownerDocument.importNode(Dom.getSingle("/p:Config/svg:g", HandleEditor.configDoc), true);
    this.svgContainer = Dom.getSingle("./svg:g[@class='Inner']", this.svgElement)

    this.svgElement.style.visibility = "hidden";
    canvas.installControlSVGElement(this.svgElement);


    //register event
    var thiz = this;

    //registering event on the outmost item to have better UI interation
    var outmostItem = this.svgElement.ownerDocument.documentElement;
    outmostItem.addEventListener("mousedown", function (ev) {
        if (thiz.passivated) {
            outmostItem.removeEventListener("mousedown", arguments.callee, false);
            return;
        }
        thiz.handleMouseDown(ev);
    }, false);
    outmostItem.addEventListener("mouseup", function (ev) {
        if (thiz.passivated) {
            outmostItem.removeEventListener("mouseup", arguments.callee, false);
            return;
        }
        thiz.handleMouseUp(ev);
    }, false);
    outmostItem.addEventListener("mousemove", function (ev) {
        if (thiz.passivated) {
            outmostItem.removeEventListener("mousemove", arguments.callee, false);
            return;
        }
        thiz.handleMouseMove(ev);
    }, false);

};
HandleEditor.prototype.attach = function (targetObject) {
    if (!targetObject) return;
    if (targetObject.constructor != Shape) {
        this.dettach();
        return;
    }

    this.targetObject = targetObject;

    var geo = this.canvas.getZoomedGeo(this.targetObject);
    this.setEditorGeometry(geo);

    this.svgElement.style.visibility = "visible";
    this.setupHandles();
};
HandleEditor.prototype.invalidate = function () {
    if (!this.targetObject) return;
    var currentTarget = this.targetObject;
    this.dettach();
    this.attach(currentTarget);
};
HandleEditor.prototype.nextTool = function () {
    //just ignore this, since this editor implements only one tool set
};

HandleEditor.prototype.dettach = function () {
    if (!this.targetObject) return;

    this.targetObject = null;
    this.svgElement.style.visibility = "hidden";
};

HandleEditor.prototype.setEditorGeometry = function (geo) {
    //transformation
    Svg.ensureCTM(this.svgElement, geo.ctm);
    this.geo = geo;
};
HandleEditor.prototype.findHandle = function (element) {
    var thiz = this;
    var handle = Dom.findUpward(element, function (node) {
        return node._isHandle && (node._editor == thiz);
    });

    return handle;
};
HandleEditor.prototype.handleMouseDown = function (event) {
    this.currentHandle = this.findHandle(event.originalTarget);
    this.oX = event.clientX;
    this.oY = event.clientY;

    //finding matching outlet
    if (this.currentHandle) {
        var def = this.currentHandle._def;
        if (def.meta && def.meta.connectTo) {
            var classes = def.meta.connectTo;
            this.currentMatchingOutlets = Connector.getMatchingOutlets(this.canvas, this.targetObject.svg, classes);
        } else {
            this.currentMatchingOutlets = [];
        }

        debug("matching outlets: " + this.currentMatchingOutlets.length);
    }
};
HandleEditor.prototype.handleMouseUp = function (event) {
    try {
        if (this.currentHandle && this.targetObject) {
            //commiting the change
            this.currentHandle._x = this.currentHandle._newX;
            this.currentHandle._y = this.currentHandle._newY;

            if (this.lastMatchedOutlet) {
                var h = new Handle(Math.round(this.lastMatchedOutlet.x), Math.round(this.lastMatchedOutlet.y));
                h.meta = {
                    connectedShapeId: this.lastMatchedOutlet.shapeId,
                    connectedOutletId: this.lastMatchedOutlet.id
                };
                this.targetObject.setProperty(this.currentHandle._def.name, h);
            } else {
                var h = new Handle(Math.round(this.currentHandle._x / this.canvas.zoom), Math.round(this.currentHandle._y / this.canvas.zoom));
                this.targetObject.setProperty(this.currentHandle._def.name, h);
            }

            this.canvas.invalidateEditors(this);
        }
    } finally {
        this.currentHandle = null;
    }
};
HandleEditor.prototype.handleMouseMove = function (event) {
    event.preventDefault();
    if (!this.currentHandle) return;

    if (this.targetObject.dockingManager) {
        this.targetObject.dockingManager.altKey = event.altKey;
    }

    var uPoint1 = Svg.vectorInCTM(new Point(this.oX, this.oY), this.geo.ctm);
    var uPoint2 = Svg.vectorInCTM(new Point(event.clientX, event.clientY), this.geo.ctm);


    dx = uPoint2.x - uPoint1.x;
    dy = uPoint2.y - uPoint1.y;

    var constraints = this.getPropertyConstraints(this.currentHandle);

    dx = constraints.lockX ? 0 : dx;
    dy = constraints.lockY ? 0 : dy;

    if (!event.shiftKey && Config.get("edit.snap.grid", false) == true) {
        var grid = Pencil.getGridSize();
        dx = grid.w * Math.round(dx / grid.w);
        dy = grid.h * Math.round(dy / grid.h);
    }

    var newX = this.currentHandle._x + dx;
    var newY = this.currentHandle._y + dy;
    if (!constraints.lockX) newX = Math.min(Math.max(newX, constraints.minX*Pencil.activeCanvas.zoom), constraints.maxX*Pencil.activeCanvas.zoom);
    if (!constraints.lockY) newY = Math.min(Math.max(newY, constraints.minY*Pencil.activeCanvas.zoom), constraints.maxY*Pencil.activeCanvas.zoom);

    if (uPoint1.x != uPoint2.x || uPoint1.y != uPoint2.y) {
        if (constraints.constraintFunction) {
            var a = {
                x: this.currentHandle._x,
                y: this.currentHandle._y
            };
            var b = {
                x: newX,
                y: newY
            };
            var result = constraints.constraintFunction(a, b);
            //debug("result: " + result.toSource());


            newX = result.x;
            newY = result.y;
            //debug("constraintFunction result: " + result.toSource());
        }
    }

    this.currentHandle._newX = newX;
    this.currentHandle._newY = newY;

    Svg.setX(this.currentHandle, this.currentHandle._newX);
    Svg.setY(this.currentHandle, this.currentHandle._newY);

    //find matching outlets
    var x = this.currentHandle._newX / this.canvas.zoom;
    var y = this.currentHandle._newY / this.canvas.zoom;

    var delta = 8;
    var found = false;
    for (var i = 0; i < this.currentMatchingOutlets.length; i ++) {
        var outlet = this.currentMatchingOutlets[i];
        if (Math.abs(x - outlet.x) < delta &&
            Math.abs(y - outlet.y) < delta) {
            this.lastMatchedOutlet = outlet;
            this.currentHandle.setAttributeNS(PencilNamespaces.p, "p:connected", "true");
            
            Svg.setX(this.currentHandle, outlet.x * this.canvas.zoom);
            Svg.setY(this.currentHandle, outlet.y * this.canvas.zoom);
            
            debug("Found matching outlet: " + outlet.id);
            found = true;
            break;
        }
    };

    if (!found) {
        this.currentHandle.removeAttributeNS(PencilNamespaces.p, "connected");
        this.lastMatchedOutlet = null;
    }

};
HandleEditor.prototype.getPropertyConstraints = function (handle) {
    if (!this.currentHandle) return {};
    return this.getPropertyConstraintsFromDef(this.currentHandle._def);
};
HandleEditor.prototype.getPropertyConstraintsFromDef = function (def) {
    if (!def) return {};

    this.targetObject.prepareExpressionEvaluation();

    var meta = def.meta;

    return {
        lockX: this.targetObject.evalExpression(meta.lockX, false),
        lockY: this.targetObject.evalExpression(meta.lockY, false),
        disabled: this.targetObject.evalExpression(meta.disabled, false),
        maxX: this.targetObject.evalExpression(meta.maxX, Number.MAX_VALUE),
        minX: this.targetObject.evalExpression(meta.minX, 0 - Number.MAX_VALUE),
        maxY: this.targetObject.evalExpression(meta.maxY, Number.MAX_VALUE),
        minY: this.targetObject.evalExpression(meta.minY, 0 - Number.MAX_VALUE),
        constraintFunction: meta.constraintFunction ? this.targetObject.evalExpression("(" + meta.constraintFunction + ")", 0 - Number.MAX_VALUE) : null
    };
};

HandleEditor.prototype.createHandle = function (def, value) {
    var p = value;
    if (!p) return;

    p.x *= this.canvas.zoom;
    p.y *= this.canvas.zoom;

    var rect = this.svgElement.ownerDocument.createElementNS(PencilNamespaces.svg, "rect");
    rect.setAttribute("x", p.x);
    rect.setAttribute("y", p.y);
    rect.setAttribute("width", HandleEditor.ANCHOR_SIZE);
    rect.setAttribute("height", HandleEditor.ANCHOR_SIZE);
    rect.setAttribute("title", def.displayName);

    rect.setAttribute("transform", "translate(" + [0 - HandleEditor.ANCHOR_SIZE / 2, 0 - HandleEditor.ANCHOR_SIZE / 2] + ")");

    rect.setAttributeNS(PencilNamespaces.p, "p:name", "Handle");
    rect._isHandle = true;
    rect._editor = this;
    rect._def = def;
    rect._x = p.x;
    rect._y = p.y;
    rect._newX = p.x;
    rect._newY = p.y;

    this.svgElement.appendChild(rect);

    try {
        var constraints = this.getPropertyConstraintsFromDef(def);
        if (constraints.disabled) {
            rect.style.visibility = "hidden";
        }
    } catch (e) {
        Console.dumpError(e, "stdout");
    }
};
HandleEditor.prototype.setupHandles = function () {
    //remove all handles
    while (this.svgElement.lastChild._isHandle) this.svgElement.removeChild(this.svgElement.lastChild);

    var properties = this.targetObject.getProperties();
    var def = this.targetObject.def;

    for (name in properties) {
        var value = properties[name];
        if (!value || value.constructor != Handle) {
            continue;
        }

        this.createHandle(def.propertyMap[name], value);
    }
};

Pencil.registerEditor(HandleEditor);
