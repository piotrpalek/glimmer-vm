import { TopLevelOperations, Handler, renderStatement } from './builder';
import { RenderResult } from './render';
import { Frame } from './environment';
import {
  ChainableReference,
  PushPullReference,
  ConstReference
} from 'htmlbars-reference';
import { ElementStack } from './builder';
import { Environment, Insertion, Helper as EnvHelper } from './environment';
import { InternedString, Dict, dict, intern } from 'htmlbars-util';

interface Bounds {
  parentNode(): Node;
  firstNode(): Node;
  lastNode(): Node;
}

interface Reference {}

import {
  HelperMorph,
  InsertionMorph,
  // SimpleHelperMorph
} from './morphs/inline';

import { Morph, ContentMorph, TemplateMorph, SimpleTemplateMorph, HasParentNode } from './morph';

import {
  BlockHelperMorph
} from "./morphs/block";

import ComponentMorph from './morphs/component';

import { AttrMorph, SetPropertyMorph } from "./morphs/attrs";

type Spec = any[];

const EMPTY_ARRAY = Object.freeze([]);

interface TemplateOptions {
  meta?: Object;
  root: Template[];
  position: number;
  locals?: InternedString[];
  statements?: StatementSyntax[];
  spec?: any;
  isEmpty?: boolean;
}

interface RenderOptions {
  hostOptions?: Object,
  appendTo: Element
}

interface EvaluateOptions {
  nextSibling?: Node
}

export default class Template {
  static fromSpec(specs: any): Template {
    let templates = new Array(specs.length);

    for (let i = 0; i < specs.length; i++) {
      let spec = specs[i];

      templates[i] = new Template({
        statements: buildStatements(spec.statements, templates),
        root: templates,
        position: i,
        meta: spec.meta,
        locals: spec.locals,
        isEmpty: spec.statements.length === 0,
        spec: spec
      });
    }

    return templates[templates.length - 1];
  }

  static fromStatements(statements: StatementSyntax[]): Template {
    return new Template({
      statements,
      root: null,
      position: null,
      meta: null,
      locals: null,
      isEmpty: statements.length === 0,
      spec: null
    });
  }

  meta: Object;
  root: Template[];
  position: number;
  arity: number;
  statements: StatementSyntax[];
  locals: InternedString[];
  spec: any[];
  isEmpty: boolean;

  constructor({ meta, root, position, locals, statements, spec, isEmpty }: TemplateOptions) {
    this.meta = meta || {};
    this.root = root;
    this.position = position;
    this.arity = locals ? locals.length : 0;
    this.statements = statements || EMPTY_ARRAY;
    this.locals = locals || EMPTY_ARRAY;
    this.spec = spec || null;
    this.isEmpty = isEmpty || false;
    Object.seal(this);
  }

  clone(): Template {
    let { meta, root, position, arity, statements, locals, spec, isEmpty } = this;
    statements = statements.slice();
    return new Template({ meta, root, position, statements, locals, spec, isEmpty });
  }

  prettyPrint() {
    function pretty(obj) {
      if (typeof obj.prettyPrint === 'function') return obj.prettyPrint();
      else throw new Error(`Cannot pretty print ${obj.constructor.name}`);
    }

    return this.root.map(template => {
      return template.statements.map(statement => pretty(statement));
    });
  }

  private evaluateWithStack(stack: ElementStack, frame: Frame) {
    this.statements.forEach(statement => stack.appendStatement(statement, frame));

    let morphs = stack.morphList();
    let bounds = stack.bounds();
    let scope = frame.scope();

    return new RenderResult({ morphs, scope, bounds, template: this });
  }

  evaluate(morph: ContentMorph, options: { nextSibling?: Node, handler?: Handler }=null): RenderResult {
    let nextSibling = options && options.nextSibling;
    let handler = options && options.handler;

    let frame = morph.frame;

    let stack = new ElementStack({ parentNode: morph.parentNode, nextSibling, dom: frame.dom() });
    if (handler) stack.addTopLevelHandler(handler);

    return this.evaluateWithStack(stack, morph.frame);
  }

  render(self: any, env: Environment, options: RenderOptions, blockArguments: any[]=null) {
    let scope = env
      .createRootScope()
      .initTopLevel(self, this.locals, blockArguments, options.hostOptions);

    let frame = env.pushFrame(scope);

    let rootMorph = new RootMorph(options.appendTo, frame);

    return this.evaluate(rootMorph, null);
  }
}

class RootMorph extends ContentMorph {
  // TODO: Yick
  firstNode() { return null; }
  lastNode() { return null; }

  init(ignored: Object) {}
  append() {}
  update() {}
  destroy() {}
}

type PrettyPrintValue = PrettyPrint | string;

class PrettyPrint {
  type: string;
  operation: string;
  params: PrettyPrintValue[];
  hash: Dict<PrettyPrintValue>;
  templates: Dict<number>;

  constructor(type: string, operation: string, params: PrettyPrintValue[]=null, hash: Dict<PrettyPrintValue>=null, templates: Dict<number>=null) {
    this.type = type;
    this.operation = operation;
    this.params = params;
    this.hash = hash;
    this.templates = templates;
  }
}

interface PrettyPrintable {
  prettyPrint(): PrettyPrint;
}

export interface ExpressionSyntax {
  isStatic: boolean;
  evaluate(frame: Frame): ChainableReference;
  prettyPrint(): any;
}

export interface StatementSyntax {
  evaluate(stack: ElementStack, frame?): any;
  type: string;
  isStatic: boolean;
}

export interface StaticStatementSyntax extends StatementSyntax, PrettyPrintable {
  evaluate(stack: ElementStack): void;
}

export interface DynamicStatementSyntax extends StatementSyntax {
  evaluate(stack: ElementStack, frame: Frame): Morph;
}

abstract class StaticExpression {
  isStatic: boolean = true;
}

abstract class DynamicExpression {
  isStatic: boolean = false;
}

type PathSexp = InternedString[];
type ExpressionSexp = any[];
type ParamsSexp = ExpressionSexp[];
type HashSexp = any[];

type BlockSexp = [InternedString, PathSexp, ParamsSexp, HashSexp, number, number];

export interface BlockOptions {

}

export class Block extends DynamicExpression implements DynamicStatementSyntax, PrettyPrintable {
  public type = "block";

  static fromSpec(sexp: BlockSexp, children: Template[]): Block {
    let [, path, params, hash, templateId, inverseId] = sexp;

    return new Block({
      path,
      args: ParamsAndHash.fromSpec(params, hash),
      templates: Templates.fromSpec(templateId, inverseId, children)
    });
  }

  static build(options): Block {
    return new this(options);
  }

  path: InternedString[];
  args: ParamsAndHash;
  templates: Templates;

  constructor(options: { path: InternedString[], args: ParamsAndHash, templates: Templates }) {
    super();
    this.path = options.path;
    this.args = options.args;
    this.templates = options.templates;
  }

  prettyPrint() {
    let [params, hash] = this.args.prettyPrint();
    let block = new PrettyPrint('expr', this.path.join('.'), params, hash);
    return new PrettyPrint('block', 'block', [block], null, this.templates.prettyPrint());
  }

  evaluate(stack: ElementStack, frame: Frame): BlockHelperMorph {
    let helper = frame.lookupHelper(this.path);
    let args = this.args.evaluate(frame);
    let templates = this.templates;

    return stack.createContentMorph(BlockHelperMorph, { helper, args, templates }, frame);
  }
}

type UnknownSexp = [string, PathSexp, boolean];

export class Unknown extends DynamicExpression implements DynamicStatementSyntax {
  public type = "unknown";

  static fromSpec(sexp: UnknownSexp): Unknown {
    let [, path, unsafe] = sexp;

    return new Unknown({ ref: new Ref(path), unsafe });
  }

  static build(path: string, unsafe: boolean): Unknown {
    return new this({ ref: Ref.build(path), unsafe });
  }

  ref: Ref;
  trustingMorph: boolean;

  constructor(options) {
    super();
    this.ref = options.ref;
    this.trustingMorph = !!options.unsafe;
  }

  prettyPrint() {
    let operation = this.trustingMorph ? 'append-html' : 'append-text';
    let get = new PrettyPrint('expr', 'unknown', [this.ref.prettyPrint()], null);
    return new PrettyPrint('append', operation, [get]);
  }

  evaluate(stack: ElementStack, frame: Frame): ContentMorph {
    let { ref, trustingMorph } = this;

    let content;

    if (ref.isHelper(frame)) {
      let path = frame.lookupHelper(ref.path());
      content = new HelperInvocationReference(path, EvaluatedParamsAndHash.empty());
    } else {
      content = ref.evaluate(frame);
    }

    return stack.createContentMorph(InsertionMorph, { content, trustingMorph }, frame);
  }
}

type InlineSexp = [string, string[], ParamsSexp, HashSexp, boolean];

export class Inline extends DynamicExpression implements DynamicStatementSyntax {
  public type = "inline";

  static fromSpec(sexp: InlineSexp) {
    let [, path, params, hash, trust] = sexp;

    return new Inline({
      path,
      trustingMorph: trust,
      args: ParamsAndHash.fromSpec(params, hash),
    });
  }

  static build(_path: string, args: ParamsAndHash, trust: boolean) {
    let path = internPath(_path);
    return new this({ path, args, trustingMorph: trust });
  }

  path: InternedString[];
  trustingMorph: boolean;
  args: ParamsAndHash;

  constructor(options) {
    super();
    this.path = options.path;
    this.trustingMorph = options.trustingMorph;
    this.args = options.args;
  }

  prettyPrint() {
    let operation = this.trustingMorph ? 'append-html' : 'append-text';
    let [params, hash] = this.args.prettyPrint();
    let helper = new PrettyPrint('expr', this.path.join('.'), params, hash);

    return new PrettyPrint('append', operation, [helper]);
  }

  evaluate(stack: ElementStack, frame: Frame): Morph {
    let helper = frame.lookupHelper(this.path);
    let content = new HelperInvocationReference(helper, this.args.evaluate(frame));
    let trustingMorph = this.trustingMorph;

    return stack.createContentMorph(HelperMorph, { content, trustingMorph }, frame);
  }
}

class HelperInvocationReference extends PushPullReference {
  private helper: ConstReference<EnvHelper>;
  private args: ChainableReference;

  constructor(helper: ConstReference<EnvHelper>, args: EvaluatedParamsAndHash) {
    super();
    this.helper = this._addSource(helper);
    this.args = this._addSource(args);
  }

  value(): Insertion {
    let { helper, args }  = this;
    let { params, hash } = args.value();
    return this.helper.value()(params, hash, null);
  }
}

/*
export class Modifier implements StatementSyntax {
  static fromSpec(node) {
    let [, path, params, hash] = node;

    return new Modifier({
      path,
      params: Params.fromSpec(params),
      hash: Hash.fromSpec(hash)
    });
  }

  static build(path, options) {
    return new Modifier({
      path,
      params: options.params,
      hash: options.hash
    });
  }

  constructor(options) {
    this.path = options.path;
    this.params = options.params;
    this.hash = options.hash;
  }

  evaluate(stack) {
    return stack.createMorph(Modifier);
  }
}
*/

export interface AttributeSyntax extends StatementSyntax {
  name: string;
  namespace?: string;

  asEvaluated(frame: Frame): AttributeSyntax;
}

type DynamicPropSexp = [string, string, ExpressionSexp, string];

export class DynamicProp extends DynamicExpression implements AttributeSyntax, DynamicStatementSyntax {
  type = "dynamic-prop";

  static fromSpec(sexp: DynamicPropSexp): DynamicProp {
    let [, name, value, namespace] = sexp;

    return new DynamicProp({
      name,
      value: buildExpression(value)
    });
  }

  static build(name: string, value: any): DynamicProp {
    return new this({ name, value });
  }

  public name: string;
  private value: ExpressionSyntax;

  constructor(options: { name: string, value: ExpressionSyntax }) {
    super();
    this.name = options.name;
    this.value = options.value;
  }

  prettyPrint() {
    let { name, value } = this;

    return new PrettyPrint('attr', 'prop', [name, value.prettyPrint()]);
  }

  asEvaluated(frame: Frame): AttributeSyntax {
    let { name, value: _value } = this;
    let value = new EvaluatedRef(_value.evaluate(frame));
    return new DynamicProp({ name, value });
  }

  evaluate(stack: ElementStack, frame: Frame): Morph {
    let { name, value } = this;
    return stack.createMorph(SetPropertyMorph, { name, value }, frame);
  }
}

type DynamicAttrSexp = [InternedString, InternedString, ExpressionSexp, InternedString];

export class DynamicAttr extends DynamicExpression implements AttributeSyntax {
  type = "dynamic-attr";

  static fromSpec(sexp: DynamicAttrSexp): DynamicAttr {
    let [, name, value, namespace] = sexp;

    return new DynamicAttr({
      name,
      namespace,
      value: buildExpression(value)
    });
  }

  static build(_name: string, value: ExpressionSyntax, _namespace: string=null): DynamicAttr {
    let name = intern(_name);
    let namespace = _namespace ? intern(_namespace) : null;
    return new this({ name, value, namespace });
  }

  name: InternedString;
  value: ExpressionSyntax & PrettyPrintable;
  namespace: InternedString;

  constructor(options: { name: InternedString, value: ExpressionSyntax, namespace: InternedString }) {
    super();
    this.name = options.name;
    this.value = options.value;
    this.namespace = options.namespace;
  }

  prettyPrint() {
    let { name, value, namespace } = this;

    if (namespace) {
      return new PrettyPrint('attr', 'attr', [name, value.prettyPrint()], { namespace });
    } else {
      return new PrettyPrint('attr', 'attr', [name, value.prettyPrint()]);
    }
  }

  asEvaluated(frame: Frame): DynamicAttr {
    let { name, value: _value, namespace } = this;
    let value = new EvaluatedRef(_value.evaluate(frame));
    return new DynamicAttr({ name, value, namespace });
  }

  evaluate(stack: ElementStack, frame: Frame): AttrMorph {
    let { name, value: _value, namespace } = this;
    let value = _value.evaluate(frame);
    return stack.createMorph(AttrMorph, { name, value, namespace }, frame);
  }
}

type ComponentSexp = [InternedString, InternedString, HashSexp, number, number];

export class Component extends DynamicExpression implements StatementSyntax {
  type = "component";

  static fromSpec(node: ComponentSexp, children: Template[]) {
    let [, path, attrs, templateId, inverseId] = node;

    return new Component({
      path: new Ref([path]),
      hash: Hash.fromSpec(attrs),
      templates: Templates.fromSpec(templateId, inverseId, children)
    });
  }

  static build(path: string, options: { default: Template, inverse: Template, hash: Hash }) {
    return new this({
      path: Ref.build(path),
      hash: options.hash || null,
      templates: Templates.build(options.default, options.inverse)
    });
  }

  path: Ref;
  hash: Hash;
  templates: Templates;

  constructor(options: { path: Ref, hash: Hash, templates: Templates }) {
    super();
    this.path = options.path;
    this.hash = options.hash;
    this.templates = options.templates;
  }

  prettyPrint() {
    let { path, hash, templates } = this;
    return new PrettyPrint('block', 'component', [path.prettyPrint()], hash.prettyPrint(), templates.prettyPrint());
  }

  evaluate(stack: ElementStack, frame: Frame): Morph {
    let { path: ref, hash, templates } = this;

    let path = ref.path();

    let definition = frame.getComponentDefinition(path, this);

    if (definition) {
      return stack.createContentMorph(ComponentMorph, { definition, attrs: this.hash, template: templates._default }, frame);
    } else if (frame.hasHelper(path)) {
      let helper = frame.lookupHelper(path);
      let args = new ParamsAndHash({ params: Params.empty(), hash: this.hash }).evaluate(frame);
      return stack.createContentMorph(BlockHelperMorph, { helper, args, templates }, frame);
    } else {
      return stack.createContentMorph(FallbackMorph, { path, hash, template: templates._default }, frame);
    }
  }
}

type FallbackOptions = { path: InternedString[], hash: Hash, template: Template };

class FallbackMorph extends ContentMorph {
  tag: string;
  template: Template;
  element: Element;
  attrs: AttributeSyntax[];

  init({ path, hash, template }: FallbackOptions) {
    this.tag = path[0];
    this.template = template;

    let attrs = [];

    let { keys, values } = hash;

    values.forEach((val, i) => {
      let key = keys[i];
      if (val.isStatic) attrs.push(StaticAttr.build(key, val.evaluate(this.frame).value()));
      else attrs.push(DynamicAttr.build(key, val));
    });

    this.attrs = attrs;
  }

  firstNode() {
    return this.element;
  }

  lastNode() {
    return this.element;
  }

  append(stack: ElementStack) {
    let { tag, attrs, template } = this;

    this.element = stack.openElement(tag);
    attrs.forEach(attr => stack.appendStatement(attr, this.frame));
    if (!template.isEmpty) stack.createContentMorph(SimpleTemplateMorph, { template }, this.frame).append(stack);
    stack.closeElement();
  }

  update() {}
}

type TextSexp = [string, string];

export class Text extends StaticExpression implements StaticStatementSyntax {
  type = "text";

  static fromSpec(node: TextSexp): Text {
    let [, content] = node;

    return new Text({ content });
  }

  static build(content): Text {
    return new this({ content });
  }

  private content: string;

  constructor(options: { content: string }) {
    super();
    this.content = options.content;
  }

  prettyPrint() {
    return new PrettyPrint('append', 'append-text', [this.content]);
  }

  evaluate(stack: ElementStack) {
    stack.appendText(this.content);
  }
}

type CommentSexp = [string, string];

export class Comment extends StaticExpression implements StaticStatementSyntax {
  type = "comment";

  static fromSpec(sexp: CommentSexp): Comment {
    let [, value] = sexp;

    return new Comment({ value });
  }

  static build(value): Comment {
    return new this({ value });
  }

  private value: string;

  constructor(options) {
    super();
    this.value = options.value;
  }

  prettyPrint() {
    return new PrettyPrint('append', 'append-comment', [this.value]);
  }

  evaluate(stack: ElementStack) {
    stack.appendComment(this.value);
  }
}

type OpenElementSexp = [string, string];

export class OpenElement extends StaticExpression implements StaticStatementSyntax {
  type = "open-element";

  static fromSpec(sexp: OpenElementSexp): OpenElement {
    let [, tag] = sexp;

    return new OpenElement({ tag });
  }

  static build(tag): OpenElement {
    return new this({ tag });
  }

  private tag: string;

  constructor(options: { tag: string }) {
    super();
    this.tag = options.tag;
  }

  prettyPrint() {
    return new PrettyPrint('element', 'open-element', [this.tag]);
  }

  evaluate(stack: ElementStack) {
    stack.openElement(this.tag);
  }
}

export class CloseElement extends StaticExpression implements StaticStatementSyntax {
  type = "close-element";

  static fromSpec() {
    return new CloseElement();
  }

  static build() {
    return new this();
  }

  prettyPrint() {
    return new PrettyPrint('element', 'close-element');
  }

  evaluate(stack: ElementStack) {
    stack.closeElement();
  }
}

type StaticAttrSexp = [InternedString, InternedString, InternedString, InternedString];

export class StaticAttr extends StaticExpression implements AttributeSyntax, StaticStatementSyntax {
  type = "static-attr";

  static fromSpec(node: StaticAttrSexp): StaticAttr {
    let [, name, value, namespace] = node;

    return new StaticAttr({ name, value, namespace });
  }

  static build(name, value, namespace=null): StaticAttr {
    return new this({ name: intern(name), value: intern(value), namespace: namespace && intern(namespace) });
  }

  name: InternedString;
  value: InternedString;
  namespace: InternedString;

  constructor(options) {
    super();
    this.name = options.name;
    this.value = options.value;
    this.namespace = options.namespace;
  }

  prettyPrint() {
    let { name, value, namespace } = this;

    if (namespace) {
      return new PrettyPrint('attr', 'attr', [name, value], { namespace });
    } else {
      return new PrettyPrint('attr', 'attr', [name, value]);
    }
  }

  asEvaluated(): AttributeSyntax {
    return this;
  }

  evaluate(stack: ElementStack) {
    let { name, value, namespace } = this;

    if (namespace) {
      stack.setAttributeNS(name, value, namespace);
    } else {
      stack.setAttribute(name, value);
    }
  }
}

// these are all constructors, indexed by statement type
const StatementNodes = {
  /// dynamic statements
  block: Block,
  inline: Inline,
  unknown: Unknown,
  //modifier: Modifier,
  dynamicAttr: DynamicAttr,
  dynamicProp: DynamicProp,
  component: Component,

  /// static statements
  text: Text,
  comment: Comment,
  openElement: OpenElement,
  closeElement: CloseElement,
  staticAttr: StaticAttr,
};

const BOUNDARY_CANDIDATES = {
  block: true,
  inline: true,
  unknown: true,
  component: true
};

export class Value extends StaticExpression implements ExpressionSyntax {
  type = "value";

  static fromSpec(value): Value {
    return new Value(value);
  }

  static build(value) {
    return new this(value);
  }

  private value: boolean | string | number;

  constructor(value) {
    super();
    this.value = value;
  }

  prettyPrint() {
    return this.value;
  }

  inner() {
    return this.value;
  }

  evaluate(): ChainableReference {
    return new ConstReference(this.value);
  }
}

type Path = InternedString[];
type GetSexp = [InternedString, Path];

export class Get extends DynamicExpression implements ExpressionSyntax, PrettyPrintable {
  type = "get";

  static fromSpec(sexp: GetSexp): Get {
    let [, parts] = sexp;

    return new Get({ ref: new Ref(parts) });
  }

  static build(path: string): Get {
    return new this({ ref: Ref.build(path) });
  }

  private ref: Ref;

  constructor(options) {
    super();
    this.ref = options.ref;
  }

  prettyPrint() {
    return new PrettyPrint('expr', 'get', [this.ref.prettyPrint()], null);
  }

  evaluate(frame: Frame): ChainableReference {
    return this.ref.evaluate(frame);
  }
}

// intern paths because they will be used as keys
function internPath(path: string): InternedString[] {
  return path.split('.').map(intern);
}

// this is separated out from Get because Unknown also has a ref, but it
// may turn out to be a helper
class Ref extends DynamicExpression implements ExpressionSyntax {
  type = "ref";

  static build(path: string): Ref {
    return new this(internPath(path));
  }

  private parts: InternedString[];

  constructor(parts: InternedString[]) {
    super();
    this.parts = parts;
  }

  prettyPrint() {
    return this.parts.join('.');
  }

  evaluate(frame: Frame): ChainableReference {
    let parts = this.parts;
    let path = frame.scope().getBase(parts[0]);

    for (let i = 1; i < parts.length; i++) {
      path = path.get(parts[i]);
    }

    return path;
  }

  path(): InternedString[] {
    return this.parts;
  }

  isHelper(frame: Frame): boolean {
    return frame.hasHelper(this.parts);
  }
}

export class EvaluatedRef implements ExpressionSyntax {
  private ref: ChainableReference;
  public isStatic = false;

  constructor(ref: ChainableReference) {
    this.ref = ref;
  }

  prettyPrint(): any {
    return this.ref.value();
  }

  evaluate(): ChainableReference {
    return this.ref;
  }
}

type HelperSexp = [string, PathSexp, ParamsSexp, HashSexp];

export class Helper implements ExpressionSyntax {
  type = "helper";

  static fromSpec(sexp: HelperSexp): Helper {
    let [, path, params, hash] = sexp;

    return new Helper({
      ref: new Ref(path),
      args: ParamsAndHash.fromSpec(params, hash)
    });
  }

  static build(path: string, params: Params, hash: Hash): Helper {
    return new this({ ref: Ref.build(path), args: new ParamsAndHash({ params, hash }) });
  }

  isStatic = false;
  ref: Ref;
  args: ParamsAndHash;

  constructor(options: { ref: Ref, args: ParamsAndHash }) {
    this.ref = options.ref;
    this.args = options.args;
  }

  prettyPrint() {
    let [params, hash] = this.args.prettyPrint();
    return new PrettyPrint('expr', this.ref.prettyPrint(), params, hash);
  }

  evaluate(frame: Frame): ChainableReference {
    let helper = frame.lookupHelper(this.ref.path());
    return new HelperInvocationReference(helper, this.args.evaluate(frame));
  }
}

type ConcatSexp = [string, ParamsSexp];

export class Concat implements ExpressionSyntax {
  type = "concat";

  static fromSpec(sexp: ConcatSexp): Concat {
    let [, params] = sexp;

    return new Concat({ parts: Params.fromSpec(params) });
  }

  static build(parts): Concat {
    return new this({ parts });
  }

  isStatic = false;
  parts: Params;

  constructor(options) {
    this.parts = options.parts;
  }

  prettyPrint() {
    return new PrettyPrint('expr', 'concat', this.parts.map(p => p.prettyPrint()));
  }

  evaluate(frame: Frame): ChainableReference {
    return new ConcatReference(this.parts.map(p => p.evaluate(frame)));
  }
}

class ConcatReference extends PushPullReference {
  private parts: ChainableReference[];

  constructor(parts: ChainableReference[]) {
    super();
    this.parts = parts;
    parts.forEach(part => {
      part.chain(this);
    })
  }

  value() {
    return this.parts.map(p => p.value()).join('');
  }
}

const ExpressionNodes = {
  get: Get,
  helper: Helper,
  concat: Concat
};

export function buildStatements(statements: any[], list: Template[]): StatementSyntax[] {
  if (statements.length === 0) { return EMPTY_ARRAY; }
  let built = statements.map(statement => StatementNodes[statement[0]].fromSpec(statement, list));

  if (statements[0][0] in BOUNDARY_CANDIDATES) {
    built[0].frontBoundary = true;
  }

  if (statements[statements.length - 1][0] in BOUNDARY_CANDIDATES) {
    built[built.length - 1].backBoundary = true;
  }

  return built;
}

function buildExpression(spec: Spec): ExpressionSyntax {
  if (typeof spec !== 'object' || spec === null) {
    return Value.fromSpec(spec);
  } else {
    return ExpressionNodes[spec[0]].fromSpec(spec);
  }
}

export class ParamsAndHash implements ExpressionSyntax {
  static fromSpec(params: ParamsSexp, hash: HashSexp): ParamsAndHash {
    return new ParamsAndHash({ params: Params.fromSpec(params), hash: Hash.fromSpec(hash) });
  }

  static _empty: ParamsAndHash;

  static empty(): ParamsAndHash {
    return (this._empty = this._empty || new ParamsAndHash({ params: Params.empty(), hash: Hash.empty() }));
  }

  static build(params: Params, hash: Hash): ParamsAndHash {
    return new this({ params, hash });
  }

  public params: Params;
  public hash: Hash;
  public isStatic = false;

  constructor(options: { params: Params, hash: Hash }) {
    this.params = options.params;
    this.hash = options.hash;
  }

  prettyPrint(): [PrettyPrintValue[], Dict<PrettyPrintValue>] {
    return [this.params.prettyPrint(), this.hash.prettyPrint()];
  }

  evaluate(frame: Frame): EvaluatedParamsAndHash {
    return new EvaluatedParamsAndHash(this, frame);
  }
}

export class EvaluatedParamsAndHash extends PushPullReference {
  static _empty: EvaluatedParamsAndHash;

  static empty(): EvaluatedParamsAndHash {
    return (this._empty = this._empty || ParamsAndHash.empty().evaluate(null));
  }

  private paramsRef: ChainableReference;
  private hashRef: ChainableReference;

  constructor({ params, hash }: ParamsAndHash, frame: Frame) {
    super();
    this.paramsRef = this._addSource(params.evaluate(frame));
    this.hashRef = hash.evaluate(frame);
  }

  value(): { params: any[], hash: Dict<any> } {
    return { params: this.paramsRef.value(), hash: this.hashRef.value() };
  }
}

interface EnumerableCallback<T> {
  (value: T): void;
}

class Enumerable<T> {
  forEach(callback: EnumerableCallback<T>) {
    throw new Error(`unimplemented forEach for ${this.constructor.name}`);
  }

  map<U>(callback: (T) => U): U[] {
    let out = [];
    this.forEach(val => out.push(callback(val)));
    return out;
  }
}

export class Params extends Enumerable<ExpressionSyntax> implements ExpressionSyntax {
  static fromSpec(sexp: ParamsSexp): Params {
    if (!sexp || sexp.length === 0) return Params.empty();
    return new Params(sexp.map(buildExpression));
  }

  static build(exprs: ExpressionSyntax[]): Params {
    return new this(exprs);
  }

  static _empty: Params;

  static empty(): Params {
    return (this._empty = this._empty || new Params([]));
  }

  params: ExpressionSyntax[];
  isStatic = false;

  constructor(exprs: ExpressionSyntax[]) {
    super();
    this.params = exprs;
  }

  forEach(callback: EnumerableCallback<ExpressionSyntax>) {
    this.params.forEach(callback);
  }

  prettyPrint(): PrettyPrintValue[] {
    return this.params.map(p => p.prettyPrint());
  }

  evaluate(frame: Frame): EvaluatedParams {
    return new EvaluatedParams(this, frame);
  }
}

export class EvaluatedParams extends PushPullReference {
  public references: ChainableReference[];

  constructor(params: Params, frame: Frame) {
    super();

    this.references = params.map(param => {
      let result = param.evaluate(frame);
      this._addSource(result);
      return result;
    })
  }

  nth(n: number) {
    return this.references[n];
  }

  first() {
    return this.nth(0);
  }

  last() {
    return this.nth(this.references.length - 1);
  }

  value() {
    return this.references.map(p => p.value());
  }
}

export class Hash implements ExpressionSyntax {
  static fromSpec(rawPairs: HashSexp): Hash {
    if (!rawPairs) { return Hash.empty(); }

    let keys = [];
    let values = [];

    for (let i = 0, l = rawPairs.length; i < l; i += 2) {
      let key = rawPairs[i];
      let expr = rawPairs[i+1];
      keys.push(key);
      values.push(buildExpression(expr));
    }

    return new Hash({ keys, values });
  }

  static build(hash: Dict<ExpressionSyntax>): Hash {
    if (hash === undefined) { return Hash.empty(); }
    let keys = [];
    let values = [];

    Object.keys(hash).forEach(key => {
      keys.push(key);
      values.push(hash[key]);
    });

    return new this({ keys, values });
  }

  static _empty;

  static empty(): Hash {
    return (this._empty = this._empty || new Hash({ keys: EMPTY_ARRAY, values: EMPTY_ARRAY }));
  }

  public keys: InternedString[];
  public values: ExpressionSyntax[];
  public isStatic = false;

  constructor({ keys, values }) {
    this.keys = keys;
    this.values = values;
  }

  prettyPrint(): Dict<PrettyPrintValue> {
    let out = dict<PrettyPrintValue>();
    this.keys.forEach((key, i) => {
      out[<string>key] = this.values[i].prettyPrint();
    })
    return out;
  }

  evaluate(frame: Frame): EvaluatedHash {
    let { keys, values } = this;
    let out = new Array(values.length);

    for (let i = 0, l = values.length; i < l; i++) {
      out[i] = values[i].evaluate(frame);
    }

    return new EvaluatedHash(this, frame);
  }
}

export class EvaluatedHash extends PushPullReference {
  public values: ChainableReference[];
  public keys: InternedString[];

  constructor(hash: Hash, frame: Frame) {
    super();

    this.values = hash.values.map(value => {
      let result = value.evaluate(frame);
      this._addSource(result);
      return result;
    });

    this.keys = hash.keys;
  }

  at(key: InternedString): ChainableReference {
    let ret: ChainableReference = null;
    this.keys.some((k, i) => {
      if (k === key) { ret = this.values[i]; return true; }
    });
    return ret;
  }

  value(): Dict<any> {
    let hash = dict();
    let refs = this.values;

    this.keys.forEach((k, i) => {
      hash[<string>k] = refs[i].value();
    });

    return hash;
  }
}

export class Templates implements ExpressionSyntax {
  static fromSpec(templateId, inverseId, children): Templates {
    return new Templates({
      template: templateId === null ? null : children[templateId],
      inverse: inverseId === null ? null : children[inverseId],
    });
  }

  static build(template: Template, inverse: Template): Templates {
    return new this({ template, inverse });
  }

  public isStatic = false;
  public _default: Template;
  public _inverse: Template;

  constructor(options: { template: Template, inverse: Template }) {
    this._default = options.template;
    this._inverse = options.inverse;
  }

  prettyPrint(): Dict<number> {
    let { _default, _inverse } = this;

    return {
      default: _default && _default.position,
      inverse: _inverse && _inverse.position
    }
  }

  evaluate(frame: Frame): ChainableReference {
    throw new Error("unimplemented evaluate for ExpressionSyntax");
  }
}

export let builders = {
  value: Value.build.bind(Value),
  hash: Hash.build.bind(Hash),
  openElement: OpenElement.build.bind(OpenElement),
  closeElement: CloseElement.build.bind(CloseElement)
};

export class TemplateBuilder {
  private statements: any[];

  constructor() {
    this.statements = [];
  }

  template() {
    return Template.fromStatements(this.statements);
  }

  specExpr(spec: any[]): ExpressionSyntax {
    return buildExpression(spec);
  }

  params(params: Params, hash: Hash): ParamsAndHash {
    return new ParamsAndHash({ params, hash });
  }

  openElement(tagName: string): OpenElement {
    return OpenElement.build(tagName);
  }

  closeElement(): CloseElement {
    return CloseElement.build();
  }

  staticAttr(key: string, value: string): StaticAttr {
    return StaticAttr.build(key, value);
  }

  dynamicAttr(key: string, value: ExpressionSyntax, namespace: string=null): DynamicAttr {
    return DynamicAttr.build(key, value);
  }

  inline(path: string, params: ParamsAndHash=null, trust: boolean=false): Inline {
    return Inline.build(path, params, trust)
  }
}

// export all statement nodes as builders via their static `build` method
Object.keys(StatementNodes).forEach(key => {
  let builderKey = `${key[0].toLowerCase()}${key.slice(1)}`;
  builders[builderKey] = StatementNodes[key].build.bind(StatementNodes[key]);
});

Object.keys(builders).forEach(key => {
  TemplateBuilder.prototype[key] = function(...args) {
    this.statements.push(builders[key](...args));
  };
});