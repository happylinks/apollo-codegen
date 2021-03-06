import { readFileSync } from 'fs';
import * as path from 'path';

import { loadSchema, loadAndMergeQueryDocuments } from '../src/loading';

import { validateQueryDocument } from '../src/validation';

const schema = loadSchema(require.resolve('./starwars/schema.json'));

describe('Validation', () => {
  test(`should throw an error for AnonymousQuery.graphql`, () => {
    const inputPaths = [
      path.join(__dirname, './starwars/AnonymousQuery.graphql'),
    ];
    const document = loadAndMergeQueryDocuments(inputPaths);

    expect(
      () => validateQueryDocument(schema, document)
    ).toThrow(
      'Validation of GraphQL query document failed'
    );
  });

  test(`should throw an error for ExplicitTypename.graphql when the target is Swift`, () => {
    const inputPaths = [
      path.join(__dirname, './starwars/ExplicitTypename.graphql'),
    ];
    const document = loadAndMergeQueryDocuments(inputPaths);

    expect(
      () => validateQueryDocument(schema, document, 'swift')
    ).toThrow(
      'Validation of GraphQL query document failed'
    );
  });

  test(`should not throw an error for ExplicitTypename.graphql when the target is not Swift`, () => {
    const inputPaths = [
      path.join(__dirname, './starwars/ExplicitTypename.graphql'),
    ];
    const document = loadAndMergeQueryDocuments(inputPaths);

    validateQueryDocument(schema, document, 'flow');
    validateQueryDocument(schema, document, 'typescript');
    validateQueryDocument(schema, document, 'ts');
    validateQueryDocument(schema, document, 'json');
  });

  test(`should throw an error for TypenameAlias.graphql`, () => {
    const inputPaths = [
      path.join(__dirname, './starwars/TypenameAlias.graphql'),
    ];
    const document = loadAndMergeQueryDocuments(inputPaths);

    expect(
      () => validateQueryDocument(schema, document)
    ).toThrow(
      'Validation of GraphQL query document failed'
    );
  });
});
