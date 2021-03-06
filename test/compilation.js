import { stripIndent } from 'common-tags'

import {
  parse,
  isType,
  GraphQLID,
  GraphQLString,
  GraphQLList,
  GraphQLNonNull
} from 'graphql';

import { loadSchema } from '../src/loading'

import { compileToIR } from '../src/compilation'
import { serializeAST } from '../src/serializeToJSON'

function withStringifiedTypes(ir) {
  return JSON.parse(serializeAST(ir));
}

const schema = loadSchema(require.resolve('./starwars/schema.json'));

describe('Compiling query documents', () => {
  test(`should include variables defined in operations`, () => {
    const document = parse(`
      query HeroName($episode: Episode) {
        hero(episode: $episode) {
          name
        }
      }

      query Search($text: String!) {
        search(text: $text) {
          ... on Character {
            name
          }
        }
      }

      mutation CreateReviewForEpisode($episode: Episode!, $review: ReviewInput!) {
        createReview(episode: $episode, review: $review) {
          stars
          commentary
        }
      }
    `);

    const { operations } = withStringifiedTypes(compileToIR(schema, document));

    expect(operations['HeroName'].variables).toEqual(
      [
        { name: 'episode', type: 'Episode' }
      ]
    );

    expect(operations['Search'].variables).toEqual(
      [
        { name: 'text', type: 'String!' }
      ]
    );

    expect(operations['CreateReviewForEpisode'].variables).toEqual(
      [
        { name: 'episode', type: 'Episode!' },
        { name: 'review', type: 'ReviewInput!' }
      ]
    );
  });

  test(`should keep track of enums and input object types used in variables`, () => {
    const document = parse(`
      query HeroName($episode: Episode) {
        hero(episode: $episode) {
          name
        }
      }

      query Search($text: String) {
        search(text: $text) {
          ... on Character {
            name
          }
        }
      }

      mutation CreateReviewForEpisode($episode: Episode!, $review: ReviewInput!) {
        createReview(episode: $episode, review: $review) {
          stars
          commentary
        }
      }
    `);

    const { typesUsed } = withStringifiedTypes(compileToIR(schema, document));

    expect(typesUsed).toEqual(['Episode', 'ReviewInput', 'ColorInput']);
  });

  test(`should keep track of enums used in fields`, () => {
    const document = parse(`
      query Hero {
        hero {
          name
          appearsIn
        }

        droid(id: "2001") {
          appearsIn
        }
      }
    `);

    const { typesUsed } = withStringifiedTypes(compileToIR(schema, document));

    expect(typesUsed).toEqual(['Episode']);
  });

  test(`should keep track of types used in fields of input objects`, () => {
    const bookstore_schema = loadSchema(require.resolve('./bookstore/schema.json'));
    const document = parse(`
      query ListBooks {
        books {
          id name writtenBy { author { id name } }
        }
      }

      mutation CreateBook($book: BookInput!) {
        createBook(book: $book) {
          id, name, writtenBy { author { id name } }
        }
      }

      query ListPublishers {
        publishers {
          id name
        }
      }

      query ListAuthors($publishedBy: PublishedByInput!) {
        authors(publishedBy: $publishedBy) {
          id name publishedBy { publisher { id name } }
        }
      }
    `)

    const { typesUsed } = withStringifiedTypes(compileToIR(bookstore_schema, document));

    expect(typesUsed).toContain('IdInput');
    expect(typesUsed).toContain('WrittenByInput');
  });

  test(`should include the original field name for an aliased field`, () => {
    const document = parse(`
      query HeroName {
        r2: hero {
          name
        }
        luke: hero(episode: EMPIRE) {
          name
        }
      }
    `);

    const { operations } = compileToIR(schema, document);

    expect(operations['HeroName'].fields[0].fieldName).toBe("hero");
  });

  test(`should include field arguments`, () => {
    const document = parse(`
      query HeroName {
        hero(episode: EMPIRE) {
          name
        }
      }
    `);

    const { operations } = compileToIR(schema, document);

    expect(operations['HeroName'].fields[0].args)
      .toEqual([{ name: "episode", value: "EMPIRE" }]);
  });

  test(`should include isOptional if a field has skip or include directives`, () => {
    const document = parse(`
      query HeroNameConditionalInclusion {
        hero {
          name @include(if: false)
        }
      }

      query HeroNameConditionalExclusion {
        hero {
          name @skip(if: true)
        }
      }
    `);

    const { operations } = compileToIR(schema, document);

    expect(operations['HeroNameConditionalInclusion'].fields[0].fields[0]).toMatchObject({
      fieldName: 'name',
      isConditional: true
    });

    expect(operations['HeroNameConditionalExclusion'].fields[0].fields[0]).toMatchObject({
      fieldName: 'name',
      isConditional: true
    });
  });

  test(`should recursively flatten inline fragments with type conditions that match the parent type`, () => {
    const document = parse(`
      query Hero {
        hero {
          id
          ... on Character {
            name
            ... on Character {
              id
              appearsIn
            }
            id
          }
        }
      }
    `);

    const { operations } = compileToIR(schema, document);

    expect(operations['Hero'].fields[0].fields.map(field => field.fieldName))
      .toEqual(['id', 'name', 'appearsIn']);
  });

  test(`should recursively include fragment spreads with type conditions that match the parent type`, () => {
    const document = parse(`
      query Hero {
        hero {
          id
          ...HeroDetails
        }
      }

      fragment HeroDetails on Character {
        name
        ...MoreHeroDetails
        id
      }

      fragment MoreHeroDetails on Character {
        appearsIn
      }
    `);

    const { operations, fragments } = compileToIR(schema, document);

    expect(operations['Hero'].fields[0].fields.map(field => field.fieldName))
      .toEqual(['id', 'name', 'appearsIn']);

    expect(fragments['HeroDetails'].fields.map(field => field.fieldName))
      .toEqual(['name', 'appearsIn', 'id']);

    expect(fragments['MoreHeroDetails'].fields.map(field => field.fieldName))
      .toEqual(['appearsIn']);

    expect(operations['Hero'].fragmentsReferenced).toEqual(['HeroDetails', 'MoreHeroDetails']);
    expect(operations['Hero'].fields[0].fragmentSpreads).toEqual(['HeroDetails', 'MoreHeroDetails']);
    expect(fragments['HeroDetails'].fragmentSpreads).toEqual(['MoreHeroDetails']);
  });

  test(`should include fragment spreads from subselections`, () => {
    const document = parse(`
      query HeroAndFriends {
        hero {
          ...HeroDetails
          appearsIn
          id
          friends {
            id
            ...HeroDetails
          }
        }
      }

      fragment HeroDetails on Character {
      	name
        id
      }
    `);

    const { operations, fragments } = compileToIR(schema, document);

    expect(operations['HeroAndFriends'].fields[0].fields.map(field => field.fieldName))
      .toEqual(['name', 'id', 'appearsIn', 'friends']);
    expect(operations['HeroAndFriends'].fields[0].fields[3].fields.map(field => field.fieldName))
      .toEqual(['id', 'name']);

    expect(fragments['HeroDetails'].fields.map(field => field.fieldName))
      .toEqual(['name', 'id']);

    expect(operations['HeroAndFriends'].fragmentsReferenced).toEqual(['HeroDetails']);
    expect(operations['HeroAndFriends'].fields[0].fragmentSpreads).toEqual(['HeroDetails']);
  });

  test(`should include type conditions with merged fields for inline fragments`, () => {
    const document = parse(`
      query Hero {
        hero {
          name
          ... on Droid {
            primaryFunction
          }
          ... on Human {
            height
          }
        }
      }
    `);

    const { operations } = compileToIR(schema, document);

    expect(operations['Hero'].fields[0].fields.map(field => field.fieldName))
      .toEqual(['name']);

    expect(operations['Hero'].fields[0].inlineFragments[0].typeCondition.toString()).toEqual('Droid');
    expect(operations['Hero'].fields[0].inlineFragments[0].fields.map(field => field.fieldName))
        .toEqual(['name', 'primaryFunction']);

    expect(operations['Hero'].fields[0].inlineFragments[1].typeCondition.toString()).toEqual('Human');
    expect(operations['Hero'].fields[0].inlineFragments[1].fields.map(field => field.fieldName))
        .toEqual(['name', 'height']);
  });

  test(`should include fragment spreads with type conditions`, () => {
    const document = parse(`
      query Hero {
        hero {
          name
          ...DroidDetails
          ...HumanDetails
        }
      }

      fragment DroidDetails on Droid {
        primaryFunction
      }

      fragment HumanDetails on Human {
        height
      }
    `);

    const { operations, fragments } = compileToIR(schema, document);

    expect(operations['Hero'].fields[0].fields.map(field => field.fieldName))
      .toEqual(['name']);

    expect(operations['Hero'].fields[0].inlineFragments[0].typeCondition.toString()).toEqual('Droid');
    expect(operations['Hero'].fields[0].inlineFragments[0].fields.map(field => field.fieldName))
        .toEqual(['name', 'primaryFunction']);

    expect(operations['Hero'].fields[0].inlineFragments[1].typeCondition.toString()).toEqual('Human');
    expect(operations['Hero'].fields[0].inlineFragments[1].fields.map(field => field.fieldName))
        .toEqual(['name', 'height']);

    expect(operations['Hero'].fragmentsReferenced).toEqual(['DroidDetails', 'HumanDetails']);
    expect(operations['Hero'].fields[0].fragmentSpreads).toEqual(['DroidDetails', 'HumanDetails']);
  });

  test(`should not include type conditions for fragment spreads with type conditions that match the parent type`, () => {
    const document = parse(`
      query Hero {
        hero {
          name
          ...HeroDetails
        }
      }

      fragment HeroDetails on Character {
        name
      }
    `);

    const { operations } = compileToIR(schema, document);

    expect(operations['Hero'].fields[0].inlineFragments).toEqual([]);
  });

  test(`should include type conditions for inline fragments in fragments`, () => {
    const document = parse(`
      query Hero {
        hero {
          ...HeroDetails
        }
      }

      fragment HeroDetails on Character {
        name
        ... on Droid {
          primaryFunction
        }
        ... on Human {
          height
        }
      }
    `);

    const { operations, fragments } = compileToIR(schema, document);

    expect(operations['Hero'].fields[0].fields.map(field => field.fieldName))
      .toEqual(['name']);

    expect(operations['Hero'].fields[0].inlineFragments[0].typeCondition.toString()).toEqual('Droid');
    expect(operations['Hero'].fields[0].inlineFragments[0].fields.map(field => field.fieldName))
        .toEqual(['name', 'primaryFunction']);

    expect(operations['Hero'].fields[0].inlineFragments[1].typeCondition.toString()).toEqual('Human');
    expect(operations['Hero'].fields[0].inlineFragments[1].fields.map(field => field.fieldName))
        .toEqual(['name', 'height']);

    expect(operations['Hero'].fragmentsReferenced).toEqual(['HeroDetails']);
    expect(operations['Hero'].fields[0].fragmentSpreads).toEqual(['HeroDetails']);
  });

  test(`should inherit type condition when nesting an inline fragment in an inline fragment with a more specific type condition`, () => {
    const document = parse(`
      query HeroName {
        hero {
          ... on Droid {
            ... on Character {
              name
            }
          }
        }
      }
    `);

    const { operations } = compileToIR(schema, document);

    expect(operations['HeroName'].fields[0].fields.map(field => field.fieldName))
      .toEqual([]);
    expect(operations['HeroName'].fields[0].inlineFragments[0].typeCondition.toString()).toEqual('Droid');
    expect(operations['HeroName'].fields[0].inlineFragments[0].fields.map(field => field.fieldName))
      .toEqual(['name']);
  });

  test(`should not inherit type condition when nesting an inline fragment in an inline fragment with a less specific type condition`, () => {
    const document = parse(`
      query HeroName {
        hero {
          ... on Character {
            ... on Droid {
              name
            }
          }
        }
      }
    `);

    const { operations } = compileToIR(schema, document);

    expect(operations['HeroName'].fields[0].fields.map(field => field.fieldName))
      .toEqual([]);
    expect(operations['HeroName'].fields[0].inlineFragments[0].typeCondition.toString()).toEqual('Droid');
    expect(operations['HeroName'].fields[0].inlineFragments[0].fields.map(field => field.fieldName))
      .toEqual(['name']);
  });

  test(`should inherit type condition when nesting a fragment spread in an inline fragment with a more specific type condition`, () => {
    const document = parse(`
      query HeroName {
        hero {
          ... on Droid {
            ...CharacterName
          }
        }
      }

      fragment CharacterName on Character {
        name
      }
    `);

    const { operations } = compileToIR(schema, document);

    expect(operations['HeroName'].fields[0].fields.map(field => field.fieldName))
      .toEqual([]);
    expect(operations['HeroName'].fields[0].inlineFragments[0].typeCondition.toString()).toEqual('Droid');
    expect(operations['HeroName'].fields[0].inlineFragments[0].fields.map(field => field.fieldName))
      .toEqual(['name']);
    expect(operations['HeroName'].fields[0].inlineFragments[0].fragmentSpreads).toEqual(['CharacterName']);

    expect(operations['HeroName'].fragmentsReferenced).toEqual(['CharacterName']);
    expect(operations['HeroName'].fields[0].fragmentSpreads).toEqual([]);
  });

  test(`should not inherit type condition when nesting a fragment spread in an inline fragment with a less specific type condition`, () => {
    const document = parse(`
      query HeroName {
        hero {
          ... on Character {
            ...DroidName
          }
        }
      }

      fragment DroidName on Droid {
        name
      }
    `);

    const { operations } = compileToIR(schema, document);

    expect(operations['HeroName'].fields[0].fields.map(field => field.fieldName))
      .toEqual([]);
    expect(operations['HeroName'].fields[0].inlineFragments[0].typeCondition.toString()).toEqual('Droid');
    expect(operations['HeroName'].fields[0].inlineFragments[0].fields.map(field => field.fieldName))
      .toEqual(['name']);
    expect(operations['HeroName'].fields[0].inlineFragments[0].fragmentSpreads).toEqual(['DroidName']);

    expect(operations['HeroName'].fragmentsReferenced).toEqual(['DroidName']);
    // FIXME
    // expect(operations['HeroName'].fields[0].fragmentSpreads).toEqual([]);
  });

  test(`should ignore inline fragment when the type condition does not overlap with the currently effective type`, () => {
    const document = parse(`
      fragment CharacterDetails on Character {
        ... on Droid {
          primaryFunction
        }
        ... on Human {
          height
        }
      }

      query HumanAndDroid {
        human(id: "human") {
          ...CharacterDetails
        }
        droid(id: "droid") {
          ...CharacterDetails
        }
      }
    `);

    const { operations } = compileToIR(schema, document);

    expect(operations['HumanAndDroid'].fields.map(field => field.fieldName))
      .toEqual(['human', 'droid']);
    expect(operations['HumanAndDroid'].fields[0].fields.map(field => field.fieldName))
      .toEqual(['height']);
    expect(operations['HumanAndDroid'].fields[0].inlineFragments).toEqual([]);
    expect(operations['HumanAndDroid'].fields[1].fields.map(field => field.fieldName))
      .toEqual(['primaryFunction']);
    expect(operations['HumanAndDroid'].fields[1].inlineFragments).toEqual([]);
  });

  test(`should ignore fragment spread when the type condition does not overlap with the currently effective type`, () => {
    const document = parse(`
      fragment DroidPrimaryFunction on Droid {
        primaryFunction
      }

      fragment HumanHeight on Human {
        height
      }

      fragment CharacterDetails on Character {
        ...DroidPrimaryFunction
        ...HumanHeight
      }

      query HumanAndDroid {
        human(id: "human") {
          ...CharacterDetails
        }
        droid(id: "droid") {
          ...CharacterDetails
        }
      }
    `);

    const { operations } = compileToIR(schema, document);

    expect(operations['HumanAndDroid'].fields.map(field => field.fieldName))
      .toEqual(['human', 'droid']);
    expect(operations['HumanAndDroid'].fields[0].fields.map(field => field.fieldName))
      .toEqual(['height']);
    expect(operations['HumanAndDroid'].fields[0].inlineFragments).toEqual([]);
    expect(operations['HumanAndDroid'].fields[1].fields.map(field => field.fieldName))
      .toEqual(['primaryFunction']);
    expect(operations['HumanAndDroid'].fields[1].inlineFragments).toEqual([]);
  });

  test(`should include type conditions for inline fragments on a union type`, () => {
    const document = parse(`
      query Search {
        search(text: "an") {
          ... on Character {
            name
          }
          ... on Droid {
            primaryFunction
          }
          ... on Human {
            height
          }
        }
      }
    `);

    const { operations } = compileToIR(schema, document);

    expect(operations['Search'].fields[0].fields.map(field => field.fieldName))
      .toEqual([]);

    expect(operations['Search'].fields[0].inlineFragments[0].typeCondition.toString()).toEqual('Droid');
    expect(operations['Search'].fields[0].inlineFragments[0].fields.map(field => field.fieldName))
      .toEqual(['name', 'primaryFunction']);

    expect(operations['Search'].fields[0].inlineFragments[1].typeCondition.toString()).toEqual('Human');
    expect(operations['Search'].fields[0].inlineFragments[1].fields.map(field => field.fieldName))
      .toEqual(['name', 'height']);
  });

  xtest(`should keep correct field ordering even if field has been visited before for other type condition`, () => {
    const document = parse(`
      fragment HeroDetails on Character {
        ... on Human {
          appearsIn
        }

        ... on Droid {
          name
          appearsIn
        }
      }
    `);

    const { fragments } = compileToIR(schema, document);

    expect(fragments['HeroDetails'].inlineFragments[1].typeCondition.toString()).toEqual('Droid');
    expect(fragments['HeroDetails'].inlineFragments[1].fields.map(field => field.fieldName))
      .toEqual(['name', 'appearsIn']);
  });

  test(`should keep track of fragments referenced in a subselection`, () => {
    const document = parse(`
      query HeroAndFriends {
        hero {
          name
          friends {
            ...HeroDetails
          }
        }
      }

      fragment HeroDetails on Character {
        name
      }
    `);

    const { operations } = compileToIR(schema, document);

    expect(operations['HeroAndFriends'].fragmentsReferenced).toEqual(['HeroDetails']);
  });

  test(`should keep track of fragments referenced in a fragment within a subselection`, () => {
    const document = parse(`
      query HeroAndFriends {
        hero {
          ...HeroDetails
        }
      }

      fragment HeroDetails on Character {
        friends {
          ...HeroName
        }
      }

      fragment HeroName on Character {
        name
      }
    `);

    const { operations } = compileToIR(schema, document);

    expect(operations['HeroAndFriends'].fragmentsReferenced).toEqual(['HeroName', 'HeroDetails']);
  });

  test(`should keep track of fragments referenced in a subselection nested in an inline fragment`, () => {
    const document = parse(`
      query HeroAndFriends {
        hero {
          name
          ... on Droid {
            friends {
              ...HeroDetails
            }
          }
        }
      }

      fragment HeroDetails on Character {
        name
      }
    `);

    const { operations } = compileToIR(schema, document);

    expect(operations['HeroAndFriends'].fragmentsReferenced).toEqual(['HeroDetails']);
  });

  test(`should include the source of operations`, () => {
    const source = stripIndent`
      query HeroName {
        hero {
          name
        }
      }
    `
    const document = parse(source);

    const { operations } = compileToIR(schema, document);

    expect(operations['HeroName'].source).toBe(source);
  });

  test(`should include the source of fragments`, () => {
    const source = stripIndent`
      fragment HeroDetails on Character {
        name
      }
    `
    const document = parse(source);

    const { fragments } = compileToIR(schema, document);

    expect(fragments['HeroDetails'].source).toBe(source);
  });

  test(`should include the source of operations with __typename added when addTypename is true`, () => {
    const source = stripIndent`
      query HeroName {
        hero {
          name
        }
      }
    `
    const document = parse(source);

    const { operations } = compileToIR(schema, document, { addTypename: true });

    expect(operations['HeroName'].source).toBe(stripIndent`
      query HeroName {
        hero {
          __typename
          name
        }
      }
    `);
  });

  test(`should include the source of fragments with __typename added when addTypename is true`, () => {
    const source = stripIndent`
      fragment HeroDetails on Character {
        name
      }
    `
    const document = parse(source);

    const { fragments } = compileToIR(schema, document, { addTypename: true });

    expect(fragments['HeroDetails'].source).toBe(stripIndent`
      fragment HeroDetails on Character {
        __typename
        name
      }
    `);
  });

  test(`should include the operationType for a query`, () => {
    const source = stripIndent`
      query HeroName {
        hero {
          name
        }
      }
    `
    const document = parse(source);

    const { operations } = compileToIR(schema, document);

    expect(operations['HeroName'].operationType).toBe('query');
  });

  test(`should include the operationType for a mutation`, () => {
    const source = stripIndent`
      mutation CreateReview {
        createReview {
          stars
          commentary
        }
      }
    `
    const document = parse(source);

    const { operations } = compileToIR(schema, document);

    expect(operations['CreateReview'].operationType).toBe('mutation');
  });
});
